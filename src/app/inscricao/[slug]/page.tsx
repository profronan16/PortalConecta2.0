'use client';

import React, { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  ChevronRight, CheckCircle, AlertCircle, ArrowLeft,
  Loader2, FileText, Clock,
} from 'lucide-react';
import { criarInscricao } from '@/actions/inscricao';
import { formatDate } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { TurnstileWidget } from '@/components/ui/turnstile-widget';
import { Field, Fieldset } from '@/components/ui/FormFieldPrimitives';
import { PerguntasExtraFields } from '@/components/ui/PerguntasExtraFields';
import { parsePerguntasExtra, coletarRespostasExtra, type PerguntaExtra } from '@/lib/formulario-extra';

type VagaInfo = {
  id: string;
  titulo: string;
  tipo: 'BOLSISTA' | 'VOLUNTARIO' | 'AMBOS';
  descricao: string | null;
  quantidade: number;
  valorBolsa: number | null;
  cargaHorariaSemanal: number | null;
};

type ProjetoInfo = {
  id: string;
  nome: string;
  inscricoes_abertas: boolean;
  inscricao_inicio: Date | null;
  inscricao_fim: Date | null;
  vagasBolsista: number;
  vagasVoluntario: number;
  vagas: VagaInfo[];
  formulario_extra?: unknown;
};

const CURSOS_SUPERIORES = [
  'Sistemas de Informação',
  'Física',
  'Engenharia Agronômica',
];

const CURSOS_TECNICOS = [
  'Informática Integrado',
  'Eletrotécnica Integrado',
  'Agropecuária Integrado',
  'Agroecologia Integrado',
  'Eletrotécnica Subsequente',
];

const CURSOS_FIC = [
  'Formação Inicial e Continuada (FIC)',
];

const CURSOS_POS = [
  'Pós-graduação',
];

const TODOS_OS_CURSOS = [
  { group: 'Cursos Superiores', options: CURSOS_SUPERIORES },
  { group: 'Cursos Técnicos', options: CURSOS_TECNICOS },
  { group: 'Cursos FIC', options: CURSOS_FIC },
  { group: 'Pós-graduação', options: CURSOS_POS },
];

const SEMESTRES = Array.from({ length: 10 }, (_, i) => i + 1);

const ANOS_INICIO = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

export default function InscricaoPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const { user } = useAuth();

  const [projeto, setProjeto] = useState<ProjetoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [protocolo, setProtocolo] = useState('');
  const [isPending, startTransition] = useTransition();

  // Estado para cálculo automático de turma
  const [anoInicio, setAnoInicio] = useState<string>('');
  const [semestre, setSemestre] = useState<string>('');
  const [turmaCalculada, setTurmaCalculada] = useState('');

  // Vaga escolhida (quando o projeto tem vagas reais cadastradas)
  const [vagaId, setVagaId] = useState<string>('');

  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  // Calcular turma automaticamente
  React.useEffect(() => {
    if (anoInicio) {
      setTurmaCalculada(`Turma ${anoInicio}`);
    }
  }, [anoInicio]);

  // Verificar inscrições ao carregar
  React.useEffect(() => {
    fetch(`/api/projetos/check-inscricao?slug=${slug}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.projeto) setProjeto(data.projeto);
        else setError(data.error || 'Projeto não encontrado');
      })
      .catch(() => setError('Erro ao carregar projeto'))
      .finally(() => setLoading(false));
  }, [slug]);

  const temVagas = (projeto?.vagas.length ?? 0) > 0;
  const vagaEscolhida = projeto?.vagas.find((v) => v.id === vagaId);
  const perguntasExtra: PerguntaExtra[] = React.useMemo(
    () => parsePerguntasExtra(projeto?.formulario_extra),
    [projeto?.formulario_extra]
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (temVagas && !vagaId) {
      setError('Escolha uma vaga para se inscrever');
      return;
    }

    if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captchaToken) {
      setError('Complete a verificação de segurança abaixo.');
      return;
    }

    const form = new FormData(e.currentTarget);

    const data = {
      projetoId: projeto!.id,
      vagaId: vagaId || undefined,
      nome_completo: form.get('nome_completo') as string,
      email: form.get('email') as string,
      telefone: form.get('telefone') as string,
      curso: form.get('curso') as string,
      turma: turmaCalculada || form.get('turma') as string,
      semestre: `${anoInicio}.${semestre}`,
      idade: form.get('idade') ? Number(form.get('idade')) : undefined,
      matricula: form.get('matricula') as string,
      genero: form.get('genero') as string,
      tipo_interesse: vagaEscolhida
        ? vagaEscolhida.tipo
        : (form.get('tipo_interesse') as 'BOLSISTA' | 'VOLUNTARIO' | 'AMBOS'),
      disponibilidade: form.getAll('disponibilidade').join(', '),
      experiencia_previa: form.get('experiencia_previa') as string,
      justificativa: form.get('justificativa') as string,
      ciencia_regras: form.get('ciencia_regras') === 'on',
      consentimento_lgpd: form.get('consentimento_lgpd') === 'on',
      campos_extra: coletarRespostasExtra(form, perguntasExtra),
      userId: user?.uid || undefined,
      captchaToken: captchaToken ?? undefined,
    };

    startTransition(async () => {
      const result = await criarInscricao(data);
      if (result.ok) {
        setProtocolo(result.data.protocolo);
        setSuccess('Inscrição realizada com sucesso!');
      } else {
        setError(result.error);
      }
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-azul-eletrico animate-spin" />
      </div>
    );
  }

  if (error && !projeto) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Erro</h1>
          <p className="text-gray-500 mb-6">{error}</p>
          <Link href="/projetos" className="text-azul-eletrico font-semibold hover:underline">
            Ver projetos
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-black text-gray-900 mb-2">Inscrição Confirmada!</h1>
          <p className="text-gray-500 text-sm mb-6">
            Sua inscrição no projeto <strong>{projeto?.nome}</strong> foi registrada com sucesso.
          </p>

          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <p className="text-xs text-gray-400 mb-1">Seu protocolo</p>
            <p className="text-2xl font-black text-azul-eletrico font-mono">{protocolo}</p>
          </div>

          <p className="text-xs text-gray-400 mb-6">
            Guarde este protocolo. Você pode usá-lo para acompanhar sua inscrição.
          </p>

          <div className="flex flex-col gap-3">
            <Link
              href="/projetos"
              className="w-full py-3 rounded-xl bg-azul-eletrico text-white font-semibold text-sm hover:bg-azul-eletrico/90 transition-all"
            >
              Voltar aos Projetos
            </Link>
            <Link
              href="/"
              className="w-full py-3 rounded-xl border border-gray-200 text-gray-600 font-semibold text-sm hover:bg-gray-50 transition-all"
            >
              Ir para o Início
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-hero-gradient pt-24 pb-8">
        <div className="container mx-auto px-4 max-w-2xl">
          <div className="flex items-center gap-2 text-white/70 text-sm mb-4">
            <Link href="/" className="hover:text-white transition-colors">Início</Link>
            <ChevronRight className="w-4 h-4" />
            <Link href="/projetos" className="hover:text-white transition-colors">Projetos</Link>
            <ChevronRight className="w-4 h-4" />
            <span className="text-white">Inscrição</span>
          </div>
          <h1 className="text-2xl font-black text-white mb-1">Inscreva-se</h1>
          <p className="text-white/80 text-sm">
            Projeto: <strong>{projeto?.nome}</strong>
          </p>
        </div>
      </div>

      {/* Info do projeto */}
      <div className="container mx-auto px-4 max-w-2xl py-6">
        <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6">
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-3">
            <Clock className="w-4 h-4" />
            <span>
              Inscrições até: <strong>{projeto?.inscricao_fim ? formatDate(projeto.inscricao_fim) : 'Não definido'}</strong>
            </span>
          </div>
          {!temVagas && (
            <div className="flex gap-4 text-sm">
              {projeto?.vagasBolsista ? (
                <span className="text-gray-600">
                  <strong className="text-gray-900">{projeto.vagasBolsista}</strong> vaga(s) bolsista(s)
                </span>
              ) : null}
              {projeto?.vagasVoluntario ? (
                <span className="text-gray-600">
                  <strong className="text-gray-900">{projeto.vagasVoluntario}</strong> vaga(s) voluntária(s)
                </span>
              ) : null}
            </div>
          )}
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
          {/* DADOS PESSOAIS */}
          <div>
            <h2 className="font-bold text-gray-900 text-lg mb-4">Dados Pessoais</h2>

            <div className="space-y-4">
              <Field label="Nome completo" required>
                <input name="nome_completo" type="text" className="input-field" required defaultValue={user?.displayName ?? ''} />
              </Field>

              <Field label="Email" required>
                <input name="email" type="email" className="input-field" required defaultValue={user?.email ?? ''} />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Telefone">
                  <input name="telefone" type="tel" className="input-field" placeholder="(00) 00000-0000" />
                </Field>
                <Field label="Idade">
                  <input name="idade" type="number" className="input-field" min="14" max="100" />
                </Field>
              </div>

              {/* Gênero - Radio buttons */}
              <Fieldset label="Gênero" required>
                <div className="flex gap-4">
                  {['Masculino', 'Feminino', 'Outro'].map((g) => (
                    <label key={g} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="genero" value={g} required className="w-4 h-4 accent-azul-eletrico" />
                      <span className="text-sm text-gray-700">{g}</span>
                    </label>
                  ))}
                </div>
              </Fieldset>
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* DADOS ACADÊMICOS */}
          <div>
            <h2 className="font-bold text-gray-900 text-lg mb-4">Dados Acadêmicos</h2>

            <div className="space-y-4">
              {/* Curso - Select com grupos */}
              <Field label="Curso" required>
                <select name="curso" className="input-field" required>
                  <option value="">Selecione seu curso</option>
                  {TODOS_OS_CURSOS.map((group) => (
                    <optgroup key={group.group} label={group.group}>
                      {group.options.map((curso) => (
                        <option key={curso} value={curso}>{curso}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-4">
                {/* Ano de início - Select */}
                <Field label="Ano de Início" required>
                  <select
                    name="ano_inicio"
                    className="input-field"
                    required
                    value={anoInicio}
                    onChange={(e) => setAnoInicio(e.target.value)}
                  >
                    <option value="">Selecione</option>
                    {ANOS_INICIO.map((ano) => (
                      <option key={ano} value={ano}>{ano}</option>
                    ))}
                  </select>
                </Field>

                {/* Semestre - Select */}
                <Field label="Semestre Atual" required>
                  <select
                    name="semestre_atual"
                    className="input-field"
                    required
                    value={semestre}
                    onChange={(e) => setSemestre(e.target.value)}
                  >
                    <option value="">Selecione</option>
                    {SEMESTRES.map((s) => (
                      <option key={s} value={s}>{s}º Semestre</option>
                    ))}
                  </select>
                </Field>
              </div>

              {/* Turma - Calculada automaticamente */}
              <Field label="Turma">
                <input
                  type="text"
                  className="input-field bg-gray-50"
                  value={turmaCalculada}
                  readOnly
                  placeholder="Preencha Ano de Início acima"
                />
                <p className="text-xs text-gray-400 mt-1">Calculado automaticamente: Turma {anoInicio || '???'}</p>
              </Field>

              <Field label="Matrícula">
                <input name="matricula" type="text" className="input-field" placeholder="Número da matrícula" />
              </Field>
            </div>
          </div>

          <hr className="border-gray-100" />

          {/* DETALHES DA INSCRIÇÃO */}
          <div>
            <h2 className="font-bold text-gray-900 text-lg mb-4">Detalhes da Inscrição</h2>

            <div className="space-y-4">
              {temVagas ? (
                <Fieldset label="Escolha a vaga" required>
                  <div className="space-y-2">
                    {projeto!.vagas.map((v) => (
                      <label
                        key={v.id}
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                          vagaId === v.id ? 'border-azul-eletrico bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="vaga_escolhida"
                          value={v.id}
                          required
                          checked={vagaId === v.id}
                          onChange={() => setVagaId(v.id)}
                          className="w-4 h-4 mt-0.5 accent-azul-eletrico"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-gray-900">
                            {v.titulo}{' '}
                            <span className="text-xs font-normal text-gray-500">
                              ({v.tipo === 'AMBOS' ? 'Bolsista ou Voluntário' : v.tipo === 'BOLSISTA' ? 'Bolsista' : 'Voluntário'})
                            </span>
                          </p>
                          {v.descricao && <p className="text-xs text-gray-500 mt-0.5">{v.descricao}</p>}
                          <p className="text-xs text-gray-400 mt-1">
                            {v.quantidade} vaga(s)
                            {v.valorBolsa ? ` · R$ ${v.valorBolsa.toFixed(2)}/mês` : ''}
                            {v.cargaHorariaSemanal ? ` · ${v.cargaHorariaSemanal}h/semana` : ''}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </Fieldset>
              ) : (
                /* Tipo de interesse - Radio buttons (fallback para projetos sem vagas cadastradas) */
                <Fieldset label="Tipo de interesse" required>
                  <div className="flex gap-4">
                    {[
                      { value: 'BOLSISTA', label: 'Bolsista' },
                      { value: 'VOLUNTARIO', label: 'Voluntário' },
                      { value: 'AMBOS', label: 'Ambos' },
                    ].map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="tipo_interesse" value={opt.value} required className="w-4 h-4 accent-azul-eletrico" />
                        <span className="text-sm text-gray-700">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </Fieldset>
              )}

              {/* Disponibilidade - Checkboxes */}
              <Fieldset label="Disponibilidade">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    'Manhã', 'Tarde', 'Noite',
                    'Seg-Sex', 'Sábados', 'Horário flexível',
                  ].map((d) => (
                    <label key={d} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-gray-50">
                      <input type="checkbox" name="disponibilidade" value={d} className="w-4 h-4 accent-azul-eletrico" />
                      <span className="text-sm text-gray-700">{d}</span>
                    </label>
                  ))}
                </div>
              </Fieldset>

              <Field label="Experiência prévia">
                <select name="experiencia_previa" className="input-field">
                  <option value="">Selecione</option>
                  <option value="nenhuma">Nenhuma experiência</option>
                  <option value="pouca">Pouca experiência (1-6 meses)</option>
                  <option value="media">Média experiência (6 meses - 2 anos)</option>
                  <option value="muita">Muita experiência (mais de 2 anos)</option>
                </select>
              </Field>

              <Field label="Por que quer participar?">
                <textarea name="justificativa" className="input-field min-h-[80px] resize-none" placeholder="Explique sua motivação..." />
              </Field>
            </div>
          </div>

          {perguntasExtra.length > 0 && (
            <>
              <hr className="border-gray-100" />
              <div>
                <h2 className="font-bold text-gray-900 text-lg mb-4">Perguntas do Projeto</h2>
                <div className="space-y-4">
                  <PerguntasExtraFields perguntas={perguntasExtra} />
                </div>
              </div>
            </>
          )}

          <hr className="border-gray-100" />

          {/* TERMOS */}
          <div>
            <h2 className="font-bold text-gray-900 text-lg mb-4">Termos</h2>

            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl hover:bg-gray-50 border border-gray-100">
                <input name="ciencia_regras" type="checkbox" required className="w-4 h-4 mt-0.5 accent-azul-eletrico" />
                <span className="text-sm text-gray-600">
                  Declaro que li e compreendo as regras do projeto e estou ciente das minhas responsabilidades. *
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl hover:bg-gray-50 border border-gray-100">
                <input name="consentimento_lgpd" type="checkbox" required className="w-4 h-4 mt-0.5 accent-azul-eletrico" />
                <span className="text-sm text-gray-600">
                  Autorizo o tratamento dos meus dados pessoais conforme a <strong>LGPD (Lei 13.709/2018)</strong> para fins de participação neste projeto. *
                </span>
              </label>
            </div>
          </div>

          <TurnstileWidget onVerify={setCaptchaToken} />

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full py-3 rounded-xl bg-azul-eletrico text-white font-semibold text-sm hover:bg-azul-eletrico/90 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Processando...</>
            ) : (
              <><FileText className="w-4 h-4" /> Enviar Inscrição</>
            )}
          </button>

          <p className="text-xs text-gray-400 text-center">
            * Campos obrigatórios
          </p>
        </form>
      </div>
    </div>
  );
}

