'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, ArrowLeft, ExternalLink, FileText, Loader2, Palette, Save,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  getPaginaDoProjeto,
  salvarPaginaDoProjeto,
  type PaginaProjetoFormData,
} from '@/actions/professor';
import { CampoMidiaProjeto } from '@/components/ui/CampoMidiaProjeto';
import { EquipeEFinanciamentoDoProjeto } from '@/components/projetos/EquipeEFinanciamentoDoProjeto';
import type { EquipeDoProjeto } from '@/lib/projetos-equipe';
import { useToast } from '@/components/ui/toast';

/**
 * Editor da APRESENTAÇÃO da página do projeto.
 *
 * Acessível ao coordenador/vice E ao aluno nomeado gestor da página. De
 * propósito só existem aqui os campos de apresentação: coordenador, situação,
 * dados do SUAP, vagas, inscrições e exclusão continuam fora deste formulário
 * (e são bloqueados no servidor também).
 */
export default function PaginaDoProjetoPage({ params }: { params: { id: string } }) {
  const { user, userRole } = useAuth();
  const { toast } = useToast();
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');
  const [form, setForm] = useState<PaginaProjetoFormData>({
    resumoCurto: '',
    descricao: '',
    logoUrl: '',
    bannerUrl: '',
    corPrimaria: '#2F52D3',
    email: '',
    instagram: '',
    site: '',
    financiamento: [],
    viceCoordenadorNome: '',
    viceCoordenadorEmail: '',
  });
  // Estudantes do projeto (das inscrições) e se este usuário pode mudar o vice.
  const [equipe, setEquipe] = useState<EquipeDoProjeto | null>(null);
  const [podeEditarVice, setPodeEditarVice] = useState(false);

  const somenteGestor = userRole === 'ESTUDANTE';

  useEffect(() => {
    if (!user?.email) return;
    getPaginaDoProjeto(params.id, user.email)
      .then((p) => {
        if (!p) {
          setErro('Você não tem acesso à edição desta página.');
          return;
        }
        setNome(p.nome);
        setSlug(p.slug);
        setForm({
          resumoCurto: p.resumoCurto ?? '',
          descricao: p.descricao ?? '',
          logoUrl: p.logoUrl ?? '',
          bannerUrl: p.bannerUrl ?? '',
          corPrimaria: p.corPrimaria ?? '#2F52D3',
          email: p.email ?? '',
          instagram: p.instagram ?? '',
          site: p.site ?? '',
          financiamento: p.financiamento ?? [],
          viceCoordenadorNome: p.viceCoordenadorNome ?? '',
          viceCoordenadorEmail: p.viceCoordenadorEmail ?? '',
        });
        setEquipe(p.equipe);
        setPodeEditarVice(p.podeEditarVice);
      })
      .catch(() => setErro('Não conseguimos carregar esta página. Tente novamente.'))
      .finally(() => setCarregando(false));
  }, [params.id, user]);

  const atualizar = (campo: keyof PaginaProjetoFormData, valor: string) => {
    setForm((atual) => ({ ...atual, [campo]: valor }));
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;
    setSalvando(true);
    setErro('');
    try {
      const resultado = await salvarPaginaDoProjeto(params.id, form, user.email);
      if (resultado.ok) {
        toast('Página atualizada.', 'success');
      } else {
        setErro(resultado.error);
      }
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) {
    return <div className="py-20 text-center text-sm text-gray-500">Carregando página...</div>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href={somenteGestor ? '/professor/projetos' : `/professor/projetos/${params.id}`}
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {somenteGestor ? 'Projetos que gerencio' : 'Voltar ao projeto'}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-900">Página do projeto</h1>
          <p className="text-gray-500 text-sm mt-1">
            {nome ? `Apresentação pública de “${nome}”` : 'Apresentação pública do projeto'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/professor/projetos/${params.id}/posts`}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <FileText className="w-4 h-4" />
            Posts
          </Link>
          {slug && (
            <Link
              href={`/projetos/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Ver no portal
            </Link>
          )}
        </div>
      </div>

      {erro && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {erro}
        </div>
      )}

      <form onSubmit={salvar} className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
        <div>
          <label className="label-field">Resumo para os cards</label>
          <input
            className="input-field"
            maxLength={200}
            value={form.resumoCurto ?? ''}
            onChange={(e) => atualizar('resumoCurto', e.target.value)}
            placeholder="Uma frase curta que aparece no card do projeto"
          />
          <p className="text-xs text-gray-400 mt-1">{(form.resumoCurto ?? '').length}/200 caracteres</p>
        </div>

        <div>
          <label className="label-field">Descrição da página</label>
          <textarea
            className="input-field min-h-[160px] resize-y"
            maxLength={8000}
            value={form.descricao ?? ''}
            onChange={(e) => atualizar('descricao', e.target.value)}
            placeholder="Conte o que o projeto faz, para quem e como participar."
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <CampoMidiaProjeto
            tipo="logo"
            nome={nome}
            valor={form.logoUrl ?? ''}
            corPrimaria={form.corPrimaria}
            subpasta={params.id}
            onChange={(url) => atualizar('logoUrl', url)}
          />
          <CampoMidiaProjeto
            tipo="capa"
            nome={nome}
            valor={form.bannerUrl ?? ''}
            corPrimaria={form.corPrimaria}
            subpasta={params.id}
            onChange={(url) => atualizar('bannerUrl', url)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label-field">Cor principal</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="w-10 h-10 rounded-lg border border-gray-200 p-0.5 cursor-pointer"
                value={/^#[0-9a-f]{6}$/i.test(form.corPrimaria ?? '') ? form.corPrimaria : '#2F52D3'}
                onChange={(e) => atualizar('corPrimaria', e.target.value)}
              />
              <input
                className="input-field uppercase font-mono"
                value={form.corPrimaria ?? ''}
                onChange={(e) => atualizar('corPrimaria', e.target.value)}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
              <Palette className="w-3 h-3" /> Usada no cabeçalho da página.
            </p>
          </div>
          <div>
            <label className="label-field">E-mail de contato</label>
            <input
              type="email"
              className="input-field"
              value={form.email ?? ''}
              onChange={(e) => atualizar('email', e.target.value)}
              placeholder="contato@projeto.com"
            />
          </div>
          <div>
            <label className="label-field">Instagram</label>
            <input
              className="input-field"
              value={form.instagram ?? ''}
              onChange={(e) => atualizar('instagram', e.target.value)}
              placeholder="@usuario"
            />
          </div>
          <div>
            <label className="label-field">Site</label>
            <input
              type="url"
              className="input-field"
              value={form.site ?? ''}
              onChange={(e) => atualizar('site', e.target.value)}
              placeholder="https://..."
            />
          </div>
        </div>

        {/* Mesmo bloco do painel "Editar Projeto": vice, estudantes e financiamento. */}
        <div className="space-y-4 pt-2">
          <EquipeEFinanciamentoDoProjeto
            valores={form}
            onChange={(alteracao) => setForm((atual) => ({ ...atual, ...alteracao }))}
            equipe={equipe}
            podeEditarVice={podeEditarVice}
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={salvando}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-azul-eletrico text-white text-sm font-semibold hover:bg-azul-eletrico/90 disabled:opacity-60 transition-colors"
          >
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {salvando ? 'Salvando...' : 'Salvar página'}
          </button>
        </div>
      </form>
    </div>
  );
}
