/**
 * Upload de arquivos para o armazenamento local do servidor.
 *
 * Diferença em relação a `/api/admin/rag/upload`: aquela rota é o pipeline de
 * INDEXAÇÃO do RAG (extrai texto, gera embeddings). Esta aqui só **guarda o
 * arquivo no disco** e devolve a URL pública — é o que o professor usa para
 * anexar o PDF de um edital ou a imagem de um post.
 *
 * Autorização: a mesma checagem de papel das outras rotas do painel
 * (`adminEmail` no FormData, conferido contra a tabela `User`). Serve para
 * professor E admin, ao contrário das rotas `/api/admin/*`, que exigem ADMIN.
 *
 * Limites aplicados em `src/lib/file-storage.ts`: PDF 10 MB, imagem 5 MB.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { salvarArquivo, ArquivoInvalidoError, LIMITE_PDF_BYTES, LIMITE_IMAGEM_BYTES } from '@/lib/file-storage';

/** Papéis que podem enviar arquivo: quem tem painel (professor) ou o admin. */
async function podeEnviarArquivo(email: string | null): Promise<boolean> {
  if (!email) return false;
  const user = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  return user?.role === 'ADMIN' || user?.role === 'PROFESSOR';
}

export async function POST(request: NextRequest) {
  // NOTA DE ORDEM (limitação do Next.js, não bug): a autorização usa
  // `userEmail` que vem DENTRO do corpo do formulário, então é impossível
  // checar antes de parsear o corpo. Uma requisição sem `Content-Type`
  // multipart recebe 400 ("Content-Type was not one of...") antes de chegar ao
  // 403. Nada é lido, gravado ou exposto nesse caminho — o pedido só é
  // rejeitado por um motivo diferente do ideal.
  //
  // Para a checagem de autorização vir de fato primeiro, `userEmail` teria de
  // sair do corpo e passar a vir da sessão verificada no servidor
  // (`getVerifiedServerSession`, cookie httpOnly — já existe em
  // src/lib/session.ts). Vale fazer quando o login estiver configurado.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao ler o upload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const userEmail = formData.get('userEmail') as string | null;
  if (!(await podeEnviarArquivo(userEmail))) {
    return NextResponse.json(
      { error: 'Acesso negado: apenas professores e administradores podem enviar arquivos' },
      { status: 403 }
    );
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
  }

  // `subpasta` agrupa os arquivos por entidade (ex.: id do projeto), para a
  // pasta no disco continuar navegável. É saneada em `salvarArquivo`.
  const subpasta = (formData.get('subpasta') as string | null) || undefined;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const salvo = await salvarArquivo(buffer, file.name, subpasta);

    return NextResponse.json({
      ok: true,
      data: {
        path: salvo.path,
        url: salvo.url,
        nomeOriginal: salvo.nomeOriginal,
        tamanhoBytes: salvo.tamanhoBytes,
        mime: salvo.mime,
      },
      limites: {
        pdfBytes: LIMITE_PDF_BYTES,
        imagemBytes: LIMITE_IMAGEM_BYTES,
      },
    });
  } catch (e) {
    if (e instanceof ArquivoInvalidoError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : 'Erro desconhecido ao salvar o arquivo';
    console.error('Falha ao salvar arquivo:', msg);
    return NextResponse.json({ error: `Não foi possível salvar o arquivo: ${msg}` }, { status: 500 });
  }
}
