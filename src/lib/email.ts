import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

interface InscricaoEmailData {
  protocolo: string;
  nomeCompleto: string;
  email: string;
  projetoNome: string;
  tipoInteresse: string;
}

interface StatusUpdateEmailData {
  protocolo: string;
  nomeCompleto: string;
  email: string;
  projetoNome: string;
  novoStatus: string;
  observacao?: string;
}

const emailStyles = {
  body: 'margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #f8fafc;',
  container: 'background-color: #f8fafc; padding: 40px 20px;',
  card: 'background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);',
  header: 'background: linear-gradient(135deg, #2F52D3 0%, #7B24C7 100%); padding: 32px; text-align: center;',
  footer: 'background-color: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;',
};

function wrapEmail(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="${emailStyles.body}">
  <table width="100%" cellpadding="0" cellspacing="0" style="${emailStyles.container}">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="${emailStyles.card}">
          <tr>
            <td style="${emailStyles.header}">
              <h1 style="color: #ffffff; font-size: 24px; font-weight: 800; margin: 0;">Portal Conecta IFPR</h1>
              <p style="color: rgba(255,255,255,0.8); font-size: 14px; margin: 8px 0 0 0;">IFPR Campus Ivaiporã</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="${emailStyles.footer}">
              <p style="color: #9ca3af; font-size: 12px; margin: 0 0 4px 0;">
                Portal Conecta IFPR — Campus Ivaiporã
              </p>
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                Este é um e-mail automático. Em caso de dúvidas, entre em contato com o setor responsável.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function enviarConfirmacaoInscricao(data: InscricaoEmailData) {
  const { protocolo, nomeCompleto, email, projetoNome, tipoInteresse } = data;

  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="width: 64px; height: 64px; background-color: #dcfce7; border-radius: 50%; display: inline-block; line-height: 64px; font-size: 32px;">✓</div>
    </div>
    
    <h2 style="color: #1f2937; font-size: 20px; font-weight: 700; text-align: center; margin: 0 0 8px 0;">Inscrição Confirmada!</h2>
    <p style="color: #6b7280; font-size: 14px; text-align: center; margin: 0 0 24px 0;">Olá, ${nomeCompleto}! Sua inscrição foi registrada com sucesso.</p>
    
    <div style="background-color: #f1f5f9; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
      <p style="color: #64748b; font-size: 12px; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.5px;">Seu protocolo</p>
      <p style="color: #2F52D3; font-size: 28px; font-weight: 800; margin: 0; font-family: monospace;">${protocolo}</p>
    </div>
    
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <p style="color: #6b7280; font-size: 12px; margin: 0;">Projeto</p>
          <p style="color: #1f2937; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">${projetoNome}</p>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <p style="color: #6b7280; font-size: 12px; margin: 0;">Tipo de interesse</p>
          <p style="color: #1f2937; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">${tipoInteresse}</p>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0;">
          <p style="color: #6b7280; font-size: 12px; margin: 0;">Status</p>
          <p style="color: #1f2937; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">Recebida</p>
        </td>
      </tr>
    </table>
    
    <div style="background-color: #eff6ff; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
      <p style="color: #1e40af; font-size: 13px; margin: 0;">
        <strong>Próximos passos:</strong> Sua inscrição será analisada pelo coordenador do projeto. 
        Você receberá uma notificação quando o status for atualizado.
      </p>
    </div>
    
    <div style="text-align: center;">
      <a href="https://portal-conecta2-0.vercel.app" style="display: inline-block; background-color: #2F52D3; color: #ffffff; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
        Acessar Portal Conecta
      </a>
    </div>
  `;

  try {
    await resend.emails.send({
      from: 'Portal Conecta IFPR <noreply@portal-conecta2-0.vercel.app>',
      to: email,
      subject: `Inscrição Confirmada — ${projetoNome} (${protocolo})`,
      html: wrapEmail(content),
    });
    return { ok: true };
  } catch (error) {
    console.error('Erro ao enviar e-mail:', error);
    return { ok: false, error: String(error) };
  }
}

export async function enviarAtualizacaoStatus(data: StatusUpdateEmailData) {
  const { protocolo, nomeCompleto, email, projetoNome, novoStatus, observacao } = data;

  const statusLabels: Record<string, string> = {
    'recebida': 'Recebida',
    'em_analise': 'Em Análise',
    'selecionado': 'Selecionado(a)',
    'lista_espera': 'Lista de Espera',
    'nao_selecionado': 'Não Selecionado(a)',
    'desistente': 'Desistente',
  };

  const statusColors: Record<string, string> = {
    'recebida': '#6b7280',
    'em_analise': '#d97706',
    'selecionado': '#16a34a',
    'lista_espera': '#2563eb',
    'nao_selecionado': '#dc2626',
    'desistente': '#9ca3af',
  };

  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="width: 64px; height: 64px; background-color: #dbeafe; border-radius: 50%; display: inline-block; line-height: 64px; font-size: 28px;">📋</div>
    </div>
    
    <h2 style="color: #1f2937; font-size: 20px; font-weight: 700; text-align: center; margin: 0 0 8px 0;">Atualização da Inscrição</h2>
    <p style="color: #6b7280; font-size: 14px; text-align: center; margin: 0 0 24px 0;">Olá, ${nomeCompleto}! O status da sua inscrição foi atualizado.</p>
    
    <div style="background-color: #f1f5f9; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
      <p style="color: #64748b; font-size: 12px; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.5px;">Protocolo</p>
      <p style="color: #2F52D3; font-size: 20px; font-weight: 800; margin: 0; font-family: monospace;">${protocolo}</p>
    </div>
    
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <p style="color: #6b7280; font-size: 12px; margin: 0;">Projeto</p>
          <p style="color: #1f2937; font-size: 14px; font-weight: 600; margin: 4px 0 0 0;">${projetoNome}</p>
        </td>
      </tr>
      <tr>
        <td style="padding: 12px 0;">
          <p style="color: #6b7280; font-size: 12px; margin: 0;">Novo Status</p>
          <p style="color: ${statusColors[novoStatus] || '#6b7280'}; font-size: 16px; font-weight: 700; margin: 4px 0 0 0;">${statusLabels[novoStatus] || novoStatus}</p>
        </td>
      </tr>
      ${observacao ? `
      <tr>
        <td style="padding: 12px 0; border-top: 1px solid #e5e7eb;">
          <p style="color: #6b7280; font-size: 12px; margin: 0;">Observação</p>
          <p style="color: #1f2937; font-size: 14px; margin: 4px 0 0 0;">${observacao}</p>
        </td>
      </tr>
      ` : ''}
    </table>
    
    <div style="text-align: center;">
      <a href="https://portal-conecta2-0.vercel.app/meus-dados" style="display: inline-block; background-color: #2F52D3; color: #ffffff; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
        Ver Minhas Inscrições
      </a>
    </div>
  `;

  try {
    await resend.emails.send({
      from: 'Portal Conecta IFPR <noreply@portal-conecta2-0.vercel.app>',
      to: email,
      subject: `Status Atualizado — ${projetoNome} (${protocolo})`,
      html: wrapEmail(content),
    });
    return { ok: true };
  } catch (error) {
    console.error('Erro ao enviar e-mail de atualização:', error);
    return { ok: false, error: String(error) };
  }
}

export async function enviarBoasVindas(email: string, nome: string) {
  const content = `
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="width: 64px; height: 64px; background-color: #f3e8ff; border-radius: 50%; display: inline-block; line-height: 64px; font-size: 32px;">🎉</div>
    </div>
    
    <h2 style="color: #1f2937; font-size: 20px; font-weight: 700; text-align: center; margin: 0 0 8px 0;">Bem-vindo(a) ao Portal Conecta!</h2>
    <p style="color: #6b7280; font-size: 14px; text-align: center; margin: 0 0 24px 0;">Olá, ${nome}! Sua conta foi criada com sucesso.</p>
    
    <div style="background-color: #f1f5f9; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <h3 style="color: #1f2937; font-size: 14px; font-weight: 600; margin: 0 0 12px 0;">O que você pode fazer:</h3>
      <ul style="color: #4b5563; font-size: 13px; margin: 0; padding-left: 20px;">
        <li style="margin-bottom: 8px;">Explorar <strong>projetos</strong> de extensão, pesquisa e ensino</li>
        <li style="margin-bottom: 8px;">Conferir <strong>editais</strong> traduzidos pela IFizinha</li>
        <li style="margin-bottom: 8px;">Acompanhar a <strong>agenda</strong> do campus</li>
        <li style="margin-bottom: 8px;">Inscrever-se em projetos de interesse</li>
      </ul>
    </div>
    
    <div style="text-align: center;">
      <a href="https://portal-conecta2-0.vercel.app" style="display: inline-block; background-color: #2F52D3; color: #ffffff; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
        Começar a Explorar
      </a>
    </div>
  `;

  try {
    await resend.emails.send({
      from: 'Portal Conecta IFPR <noreply@portal-conecta2-0.vercel.app>',
      to: email,
      subject: 'Bem-vindo(a) ao Portal Conecta IFPR!',
      html: wrapEmail(content),
    });
    return { ok: true };
  } catch (error) {
    console.error('Erro ao enviar e-mail de boas-vindas:', error);
    return { ok: false, error: String(error) };
  }
}

interface AlertaEditalEmailData {
  email: string;
  nome?: string | null;
  editalTitulo: string;
  editalCategoria: string;
  editalSlug: string;
  dataEncerramento?: Date | null;
}

/**
 * Aviso de edital novo para quem assinou alerta de interesse (ROADMAP 6.4).
 * Segue o mesmo contrato dos outros envios: nunca lança, devolve { ok }.
 */
export async function enviarAlertaEdital(data: AlertaEditalEmailData) {
  const { email, nome, editalTitulo, editalCategoria, editalSlug, dataEncerramento } = data;

  const prazo = dataEncerramento
    ? `<p style="color: #6b7280; font-size: 14px; margin: 0 0 8px 0;">
         <strong>Inscrições até:</strong> ${dataEncerramento.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}
       </p>`
    : '';

  const content = `
    <h2 style="color: #1f2937; font-size: 20px; font-weight: 700; margin: 0 0 8px 0;">Novo edital de ${editalCategoria}</h2>
    <p style="color: #6b7280; font-size: 14px; margin: 0 0 20px 0;">
      Olá${nome ? `, ${nome}` : ''}! Um edital da categoria que você escolheu acompanhar foi publicado.
    </p>

    <div style="background-color: #f1f5f9; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <h3 style="color: #1f2937; font-size: 16px; font-weight: 700; margin: 0 0 12px 0;">${editalTitulo}</h3>
      <p style="color: #6b7280; font-size: 14px; margin: 0 0 8px 0;">
        <strong>Categoria:</strong> ${editalCategoria}
      </p>
      ${prazo}
    </div>

    <div style="text-align: center;">
      <a href="https://portal-conecta2-0.vercel.app/editais/${editalSlug}" style="display: inline-block; background-color: #2F52D3; color: #ffffff; font-weight: 600; font-size: 14px; padding: 12px 24px; border-radius: 8px; text-decoration: none;">
        Ver o edital
      </a>
    </div>

    <p style="color: #9ca3af; font-size: 12px; margin: 24px 0 0 0; text-align: center;">
      Você recebe este e-mail porque ativou alertas por e-mail no Portal Conecta.
      Ajuste ou desative quando quiser em "Minha área".
    </p>
  `;

  try {
    await resend.emails.send({
      from: 'Portal Conecta IFPR <noreply@portal-conecta2-0.vercel.app>',
      to: email,
      subject: `Novo edital: ${editalTitulo}`,
      html: wrapEmail(content),
    });
    return { ok: true };
  } catch (error) {
    console.error('Erro ao enviar alerta de edital:', error);
    return { ok: false, error: String(error) };
  }
}
