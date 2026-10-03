/**
 * Armazenamento de arquivos no próprio servidor (VPS).
 *
 * Layout em disco (raiz configurável por `STORAGE_ROOT`):
 *
 *   /var/www/portal-files/
 *     ├── pdf/2026/01/<uuid>.pdf
 *     ├── imagens/2026/01/<uuid>.webp
 *     └── outros/2026/01/<uuid>.bin
 *
 * O nginx serve essa mesma pasta em `https://<host>/files/...` (ver
 * `deploy/nginx-portal.ifcoding.com.br.conf`, bloco `location /files/`),
 * então `publicUrl()` monta exatamente essa URL.
 *
 * Limites exigidos pelo projeto:
 *   - PDF:    10 MB
 *   - Imagem:  5 MB
 *
 * Detalhes de segurança implementados aqui (todos os arquivos vêm de upload
 * de usuário e são servidos publicamente — é o vetor de ataque mais óbvio):
 *   1. Nome do arquivo original NUNCA vai para o disco. O nome físico é um
 *      UUID + extensão derivada do tipo VALIDADO, então nada de
 *      `../../etc/passwd` nem de nome com bytes de controle.
 *   2. O tipo é decidido pelo **conteúdo** (magic bytes), não por
 *      `file.type` nem pela extensão — ambos são controlados pelo cliente.
 *   3. Extensão permitida só existe para pdf/png/jpeg/webp/gif. Nada de
 *      .svg, .html, .js ou .php, que o nginx interpretaria no domínio.
 *   4. `STORAGE_ROOT` é resolvido com `path.resolve` e o caminho final é
 *      conferido para continuar DENTRO da raiz (defesa extra contra
 *      travessia de diretório).
 */
import { randomUUID } from 'crypto';
import { mkdir, writeFile, unlink, stat } from 'fs/promises';
import { join, resolve, extname, relative, isAbsolute, sep } from 'path';

/** Raiz de armazenamento. Em produção na VPS: /var/www/portal-files */
export const STORAGE_ROOT = resolve(
  process.env.STORAGE_ROOT || join(process.cwd(), 'storage', 'portal-files')
);

/** Prefixo público servido pelo nginx — muda a URL, não o disco. */
const PUBLIC_PREFIX = (process.env.STORAGE_PUBLIC_PREFIX || '/files').replace(/\/+$/, '');

export const LIMITE_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
export const LIMITE_IMAGEM_BYTES = 5 * 1024 * 1024; // 5 MB

export type CategoriaArquivo = 'pdf' | 'imagens' | 'outros';

interface TipoPermitido {
  categoria: CategoriaArquivo;
  extensao: string;
  mime: string;
  limite: number;
}

/**
 * Tabela de tipos aceitos, com o limite de tamanho por tipo.
 * A assinatura é a sequência de bytes no INÍCIO do arquivo (magic bytes) —
 * a checagem mais confiável que dá para fazer sem biblioteca externa.
 */
const TIPOS: Record<string, TipoPermitido> = {
  pdf: { categoria: 'pdf', extensao: '.pdf', mime: 'application/pdf', limite: LIMITE_PDF_BYTES },
  png: { categoria: 'imagens', extensao: '.png', mime: 'image/png', limite: LIMITE_IMAGEM_BYTES },
  jpeg: { categoria: 'imagens', extensao: '.jpg', mime: 'image/jpeg', limite: LIMITE_IMAGEM_BYTES },
  webp: { categoria: 'imagens', extensao: '.webp', mime: 'image/webp', limite: LIMITE_IMAGEM_BYTES },
  gif: { categoria: 'imagens', extensao: '.gif', mime: 'image/gif', limite: LIMITE_IMAGEM_BYTES },
};

function comecaCom(buf: Buffer, assinatura: number[], offset = 0): boolean {
  if (buf.length < offset + assinatura.length) return false;
  return assinatura.every((b, i) => buf[offset + i] === b);
}

/**
 * Detecta o tipo real do arquivo pelos magic bytes.
 * Retorna `null` quando não é um dos tipos permitidos.
 */
export function detectarTipoPorConteudo(buffer: Buffer): TipoPermitido | null {
  // PDF: "%PDF-"
  if (comecaCom(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return TIPOS.pdf;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (comecaCom(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return TIPOS.png;

  // JPEG: FF D8 FF
  if (comecaCom(buffer, [0xff, 0xd8, 0xff])) return TIPOS.jpeg;

  // GIF: "GIF87a" ou "GIF89a"
  if (comecaCom(buffer, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])) return TIPOS.gif;
  if (comecaCom(buffer, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return TIPOS.gif;

  // WEBP: "RIFF" .... "WEBP"  (WEBP fica no offset 8)
  if (
    comecaCom(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    comecaCom(buffer, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return TIPOS.webp;
  }

  return null;
}

export class ArquivoInvalidoError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ArquivoInvalidoError';
    this.status = status;
  }
}

export interface ArquivoSalvo {
  /** Caminho relativo dentro de STORAGE_ROOT (ex.: "pdf/2026/01/<uuid>.pdf"). */
  path: string;
  /** URL pública servida pelo nginx (ex.: "/files/pdf/2026/01/<uuid>.pdf"). */
  url: string;
  nomeOriginal: string;
  tamanhoBytes: number;
  mime: string;
}

function formatarMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

/**
 * Valida e grava um arquivo vindo de upload.
 *
 * Lança `ArquivoInvalidoError` (com `status` HTTP apropriado) quando:
 *  - o tipo real não é permitido → 415;
 *  - o tamanho passa do limite do tipo → 413;
 *  - o arquivo está vazio → 400.
 */
export async function salvarArquivo(
  buffer: Buffer,
  nomeOriginal: string,
  subpasta?: string
): Promise<ArquivoSalvo> {
  if (!buffer || buffer.length === 0) {
    throw new ArquivoInvalidoError('Arquivo vazio ou não enviado.', 400);
  }

  const tipo = detectarTipoPorConteudo(buffer);
  if (!tipo) {
    throw new ArquivoInvalidoError(
      'Tipo de arquivo não permitido. Aceitos: PDF (até 10 MB), PNG, JPG, WEBP e GIF (até 5 MB cada).',
      415
    );
  }

  if (buffer.length > tipo.limite) {
    throw new ArquivoInvalidoError(
      `Arquivo de ${(buffer.length / 1024 / 1024).toFixed(1)} MB excede o limite de ` +
        `${formatarMb(tipo.limite)} para ${tipo.mime}.`,
      413
    );
  }

  // Ano/mês mantêm as pastas navegáveis e evitam diretório único gigante.
  const agora = new Date();
  const ano = String(agora.getUTCFullYear());
  const mes = String(agora.getUTCMonth() + 1).padStart(2, '0');

  // `subpasta` (ex.: id do projeto) é opcional e sempre saneada.
  const sub = (subpasta || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

  const partes = [tipo.categoria, ano, mes, ...(sub ? [sub] : [])];
  const dirRelativo = join(...partes);

  // Nome físico: UUID + extensão validada. O nome original jamais toca o disco.
  const nomeFisico = `${randomUUID()}${tipo.extensao}`;
  const caminhoRelativo = join(dirRelativo, nomeFisico);

  const caminhoAbsoluto = resolve(STORAGE_ROOT, caminhoRelativo);

  // Defesa em profundidade contra travessia de diretório: o caminho resolvido
  // DEVE continuar dentro da raiz. Com o UUID acima isso é garantido, mas a
  // checagem impede que uma mudança futura (ex.: usar o nome original) abra
  // a falha silenciosamente.
  const rel = relative(STORAGE_ROOT, caminhoAbsoluto);
  if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new ArquivoInvalidoError('Caminho de destino inválido.', 400);
  }

  await mkdir(resolve(STORAGE_ROOT, dirRelativo), { recursive: true });
  await writeFile(caminhoAbsoluto, buffer, { mode: 0o644 });

  // URLs usam sempre "/" — são caminhos de URL, não de sistema de arquivos.
  const urlRelativa = caminhoRelativo.split(sep).join('/');

  return {
    path: urlRelativa,
    url: `${PUBLIC_PREFIX}/${urlRelativa}`,
    nomeOriginal: nomeOriginal.slice(0, 255),
    tamanhoBytes: buffer.length,
    mime: tipo.mime,
  };
}

/**
 * Remove um arquivo previamente salvo a partir do `path` relativo guardado no
 * banco. Nunca lança: se o arquivo já não existe, o objetivo (não haver
 * arquivo órfão) já está cumprido — apagar registro não pode falhar por causa
 * disso.
 */
export async function removerArquivo(pathRelativo: string | null | undefined): Promise<boolean> {
  if (!pathRelativo) return false;

  const caminhoAbsoluto = resolve(STORAGE_ROOT, pathRelativo);
  const rel = relative(STORAGE_ROOT, caminhoAbsoluto);
  if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    return false;
  }

  try {
    await unlink(caminhoAbsoluto);
    return true;
  } catch {
    return false;
  }
}

/** Metadados de um arquivo já salvo (usado em telas de diagnóstico). */
export async function infoArquivo(pathRelativo: string): Promise<{ existe: boolean; bytes: number } | null> {
  const caminhoAbsoluto = resolve(STORAGE_ROOT, pathRelativo);
  const rel = relative(STORAGE_ROOT, caminhoAbsoluto);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;

  try {
    const s = await stat(caminhoAbsoluto);
    return { existe: true, bytes: s.size };
  } catch {
    return { existe: false, bytes: 0 };
  }
}

/** `true` quando o armazenamento local está configurado para esta instância. */
export function storageConfigurado(): boolean {
  return !!STORAGE_ROOT;
}

/** Extensão aceita (apenas para mensagens de erro na UI). */
export const EXTENSOES_ACEITAS = Object.values(TIPOS).map((t) => t.extensao);
