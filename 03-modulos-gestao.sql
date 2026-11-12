-- Assados Nobre ERP — Contabilidade, EDRAS, Jurídico e dashboard multiunidade
-- Aplicar no Supabase SQL Editor após backup. Seguro para reexecução.
-- O acesso aos dados deve ocorrer exclusivamente pelo backend com service_role.

create extension if not exists pgcrypto;

create table if not exists public.gestao_lancamentos_contabeis (
  id uuid primary key default gen_random_uuid(),
  unidade_id bigint not null,
  competencia date not null,
  data_lancamento date not null default current_date,
  tipo text not null check (tipo in ('receita','despesa','transferencia','ajuste')),
  categoria text not null,
  descricao text not null,
  documento_ref text,
  centro_custo text,
  conta_financeira text,
  valor numeric(14,2) not null check (valor >= 0),
  status text not null default 'rascunho' check (status in ('rascunho','confirmado','cancelado')),
  origem text not null default 'manual',
  usuario_id text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.edras_movimentos (
  id uuid primary key default gen_random_uuid(),
  unidade_id bigint not null,
  usuario_id text not null,
  tipo text not null check (tipo in ('receita','despesa','meta','divida','reserva')),
  descricao text not null,
  categoria text not null default 'Geral',
  valor numeric(14,2) not null check (valor >= 0),
  data_referencia date not null default current_date,
  vencimento date,
  status text not null default 'planejado' check (status in ('planejado','realizado','cancelado')),
  observacoes text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.juridico_processos (
  id uuid primary key default gen_random_uuid(),
  unidade_id bigint not null,
  numero_processo text,
  tipo text not null,
  titulo text not null,
  parte_contraria text,
  responsavel text not null,
  advogado text,
  status text not null default 'em_andamento' check (status in ('em_andamento','aguardando','encerrado','arquivado')),
  nivel_sigilo text not null default 'restrito' check (nivel_sigilo in ('restrito','confidencial')),
  data_abertura date not null default current_date,
  proximo_prazo date,
  observacoes text,
  criado_por text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.juridico_prazos (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid not null references public.juridico_processos(id) on delete cascade,
  unidade_id bigint not null,
  titulo text not null,
  data_prazo timestamptz not null,
  responsavel text not null,
  status text not null default 'pendente' check (status in ('pendente','concluido','cancelado')),
  observacoes text,
  criado_em timestamptz not null default now()
);

create table if not exists public.juridico_documentos (
  id uuid primary key default gen_random_uuid(),
  processo_id uuid references public.juridico_processos(id) on delete cascade,
  unidade_id bigint not null,
  titulo text not null,
  tipo text not null,
  storage_path text not null,
  nivel_sigilo text not null default 'restrito' check (nivel_sigilo in ('restrito','confidencial')),
  enviado_por text not null,
  criado_em timestamptz not null default now()
);

create table if not exists public.gestao_auditoria (
  id bigint generated always as identity primary key,
  unidade_id bigint,
  usuario_id text not null,
  modulo text not null,
  acao text not null,
  registro_id text,
  detalhes jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists idx_contab_unidade_competencia on public.gestao_lancamentos_contabeis(unidade_id, competencia, status);
create index if not exists idx_edras_usuario_data on public.edras_movimentos(unidade_id, usuario_id, data_referencia);
create index if not exists idx_juridico_unidade_status on public.juridico_processos(unidade_id, status);
create index if not exists idx_juridico_prazos_data on public.juridico_prazos(unidade_id, data_prazo, status);
create index if not exists idx_gestao_auditoria_data on public.gestao_auditoria(unidade_id, criado_em desc);

-- Bloqueia acesso direto de navegador. O backend usa a chave service_role guardada no servidor.
alter table public.gestao_lancamentos_contabeis enable row level security;
alter table public.edras_movimentos enable row level security;
alter table public.juridico_processos enable row level security;
alter table public.juridico_prazos enable row level security;
alter table public.juridico_documentos enable row level security;
alter table public.gestao_auditoria enable row level security;

drop policy if exists gestao_contab_service_only on public.gestao_lancamentos_contabeis;
create policy gestao_contab_service_only on public.gestao_lancamentos_contabeis for all to service_role using (true) with check (true);
drop policy if exists edras_service_only on public.edras_movimentos;
create policy edras_service_only on public.edras_movimentos for all to service_role using (true) with check (true);
drop policy if exists juridico_processos_service_only on public.juridico_processos;
create policy juridico_processos_service_only on public.juridico_processos for all to service_role using (true) with check (true);
drop policy if exists juridico_prazos_service_only on public.juridico_prazos;
create policy juridico_prazos_service_only on public.juridico_prazos for all to service_role using (true) with check (true);
drop policy if exists juridico_documentos_service_only on public.juridico_documentos;
create policy juridico_documentos_service_only on public.juridico_documentos for all to service_role using (true) with check (true);
drop policy if exists gestao_auditoria_service_only on public.gestao_auditoria;
create policy gestao_auditoria_service_only on public.gestao_auditoria for all to service_role using (true) with check (true);

grant all on public.gestao_lancamentos_contabeis, public.edras_movimentos, public.juridico_processos, public.juridico_prazos, public.juridico_documentos, public.gestao_auditoria to service_role;
grant usage, select on sequence public.gestao_auditoria_id_seq to service_role;

comment on table public.edras_movimentos is 'Planejamento e acompanhamento financeiro EDRAS; não substitui aconselhamento financeiro profissional.';
comment on table public.juridico_processos is 'Controle administrativo de processos; não substitui orientação de advogado.';
