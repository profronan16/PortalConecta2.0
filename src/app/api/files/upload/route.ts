/**
 * Upload de arquivos para o armazenamento local do servidor.
 *
 * Diferença em relação a `/api/admin/rag/upload`: aquela rota é o pipeline de
 * INDEXAÇÃO do RAG (extrai texto, gera embeddings). Esta aqui só **guarda o
 * arquivo no disco** e devolve a URL pública — é o que o professor usa para
 * anexar o PDF de um edital (e imagens de post).
 *
 * Autorização (corrigida em 2026-10-03): o cliente envia o **ID token do
 * Firebase** (`idToken`) e o servidor verifica a assinatura antes de qualquer
 * coisa — o e-mail e o papel saem do token, nunca do corpo do formulário.
 *
 * Antes disso a rota recebia `userEmail` no FormData e conferia o papel desse
 * e-mail no banco: qualquer pessoa que soubesse o e-mail de um professor/admin
 * (e eles estão na documentação pública do projeto) conseguia gravar arquivos de
 * até 10 MB sem autenticação — arquivos esses servidos publicamente em `/files/`.
 *
 * Limites aplicados em `src/lib/file-storage.ts`: PDF 10 MB, imagem 5 MB.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySessionToken } from '@/lib/auth-helpers';
import { salvarArquivo, ArquivoInvalidoError, LIMITE_PDF_BYTES, LIMITE_IMAGEM_BYTES } from '@/lib/file-storage';

/** Papéis que podem enviar arquivo: quem tem painel (professor) ou o admin. */
async function papelPodeEnviar(email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  return user?.role === 'ADMIN' || user?.role === 'PROFESSOR';
}

export async function POST(request: NextRequest) {
  // NOTA DE ORDEM (limitação do Next.js, não bug): o corpo precisa ser lido
  // antes de qualquer checagem, porque o token vem dentro do multipart. Uma
  // requisição sem `Content-Type` multipart recebe 400 antes do 401. Nada é
  // lido, gravado ou exposto nesse caminho.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Falha ao ler o upload';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // ── Autorização: identidade vem do TOKEN, não do formulário ──
  const idToken = formData.get('idToken');
  const sessao = await verifySessionToken(typeof idToken === 'string' ? idToken : undefined);
  if (!sessao.ok) {
    return NextResponse.json({ error: sessao.error }, { status: 401 });
  }

  if (!(await papelPodeEnviar(sessao.email))) {
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
