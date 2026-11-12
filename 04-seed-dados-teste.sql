-- Assados Nobre ERP — DADOS FICTÍCIOS PARA TESTE (04)
-- Executar NO Supabase SQL Editor, DEPOIS de 01, 02 e 03-modulos-gestao.sql.
-- Idempotente: apaga os registros de teste pelos IDs fixos e reinsere.
-- Senha de todos os usuários de teste: 123
-- Após rodar: login no ERP com matrícula ADM (admin), SV-2026-0002 (filial) etc.
-- Site: cliente de teste cliente@teste.com / senha 123.

BEGIN;

-- ===== UNIDADES =====
delete from public.unidades where id in (1,2,3);
insert into public.unidades (id,nome,tipo,e_matriz,regime_tributario,ativo,nivel_permissao) values
 (1,'Matriz - Sede','matriz',true,'simples_nacional',true,6),
 (2,'Filial A - Centro','filial',false,'simples_nacional',true,4),
 (3,'Filial B - Shopping','filial',false,'simples_nacional',true,4);

-- ===== FUNCIONÁRIOS / LOGIN ERP (senha 123) =====
delete from public.funcionarios where id in (1,2,3,4);
insert into public.funcionarios (id,matricula,nome,cargo,unidade_id,unidade_tipo,role,senha_hash,status,salario_base,jornada_diaria,data_admissao) values
 (1,'ADM','Administrador Geral','Administrador',1,'matriz','admin','123','ATIVO',5000,8,'2024-01-01'),
 (2,'SV-2026-0001','Gerente Matriz','Gerente',1,'matriz','gerente','123','ATIVO',3500,8,'2024-02-01'),
 (3,'SV-2026-0002','Maria Silva - Filial A','Atendente',2,'filial','operador','123','ATIVO',1600,8,'2025-03-10'),
 (4,'SV-2026-0003','João Souza - Filial B','Atendente',3,'filial','operador','123','ATIVO',1600,8,'2025-04-15');

-- ===== CAIXA (para PDV / fechamento de caixa) =====
delete from public.caixas where id in (1,2,3);
insert into public.caixas (id,nome,status,saldo_inicial,saldo_atual,unidade_id,ativo) values
 (1,'Caixa Principal Matriz','fechado',0,0,1,true),
 (2,'Caixa Filial A','fechado',0,0,2,true),
 (3,'Caixa Filial B','fechado',0,0,3,true);

-- ===== PRODUTOS (o site puxa status=ATIVO e categoria <> Insumos) =====
delete from public.produtos where id in (1,2,3,4,5,6,7,8,9,10);
insert into public.produtos (id,sku,nome,categoria,sabor,preco_venda,preco_por_kg,custo,estoque_minimo,producao_propria,status,unidade_id) values
 (1,'SOR-MOR','Sorvete Morango 2L','Sorvetes','Morango',45.90,22.95,18.0,20,true,'ATIVO',1),
 (2,'SOR-CHOC','Sorvete Chocolate 2L','Sorvetes','Chocolate',45.90,22.95,18.0,20,true,'ATIVO',1),
 (3,'PIC-CHOC','Picolé Chocolate','Picolés','Chocolate',4.50,null,1.20,100,true,'ATIVO',1),
 (4,'PIC-MOR','Picolé Morango','Picolés','Morango',4.50,null,1.20,100,true,'ATIVO',1),
 (5,'ACA-300','Açaí 300ml','Açaí','Açaí com granola',12.90,null,4.50,30,true,'ATIVO',1),
 (6,'ACA-500','Açaí 500ml','Açaí','Açaí com granola',18.90,null,6.50,30,true,'ATIVO',1),
 (7,'BEB-COLA','Refrigerante Cola 350ml','Bebidas',null,5.00,null,2.50,48,false,'ATIVO',1),
 (8,'BEB-SUCO','Suco Natural 300ml','Bebidas','Laranja',7.00,null,3.00,48,true,'ATIVO',1),
 (9,'ASD-PICANHA','Assado Picanha 1kg','Assados','Picanha',89.90,89.90,45.0,10,true,'ATIVO',1),
 (10,'INS-LEITE','Leite Integral 1L','Insumos',null,6.50,null,4.80,50,false,'ATIVO',1);

-- ===== CLIENTES / FIDELIDADE (ERP) =====
delete from public.clientes where id in (1,2);
insert into public.clientes (id,nome,telefone,email,status,unidade_id) values
 (1,'Cliente Teste','41999990001','cliente@teste.com','ATIVO',1),
 (2,'Ana Cliente','41999990002','ana@teste.com','ATIVO',2);
delete from public.fidelidade where cliente_id in (1,2);
insert into public.fidelidade (cliente_id,pontos_disponiveis,valor_total_gasto) values (1,120,350.0),(2,0,0);

-- ===== CLIENTES DO SITE (login do site; senha 123 em texto) =====
delete from public.site_clientes where email in ('cliente@teste.com','ana@teste.com');
insert into public.site_clientes (nome,telefone,email,senha,origem) values
 ('Cliente Teste','41999990001','cliente@teste.com','123','site'),
 ('Ana Cliente','41999990002','ana@teste.com','123','site');

-- ===== CONTABILIDADE (lançamentos de exemplo por filial) =====
delete from public.gestao_lancamentos_contabeis where id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444');
insert into public.gestao_lancamentos_contabeis (id,unidade_id,competencia,tipo,categoria,descricao,valor,status,origem,usuario_id) values
 ('11111111-1111-4111-8111-111111111111',1,'2026-11-01','receita','Vendas','Vendas semana matriz',5200.00,'confirmado','manual','1'),
 ('22222222-2222-4222-8222-222222222222',2,'2026-11-01','despesa','Aluguel','Aluguel Filial A',1800.00,'confirmado','manual','3'),
 ('33333333-3333-4333-8333-333333333333',2,'2026-11-10','receita','Vendas','Vendas balcão (rascunho)',950.00,'rascunho','manual','3'),
 ('44444444-4444-4444-8444-444444444444',3,'2026-11-01','receita','Vendas','Vendas Filial B',3100.00,'confirmado','manual','4');

-- ===== EDRAS (planejamento financeiro pessoal por usuário) =====
delete from public.edras_movimentos where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.edras_movimentos (id,unidade_id,usuario_id,tipo,descricao,categoria,valor,data_referencia,vencimento,status) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,'1','receita','Salário','Renda',5000,'2026-11-05',null,'realizado'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',2,'3','despesa','Aluguel pessoal','Moradia',1200,'2026-11-10','2026-11-30','planejado');

-- ===== JURÍDICO (processo + prazo de exemplo na Filial A) =====
delete from public.juridico_prazos where processo_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
delete from public.juridico_processos where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
insert into public.juridico_processos (id,unidade_id,numero_processo,tipo,titulo,parte_contraria,responsavel,advogado,status,nivel_sigilo,proximo_prazo,criado_por) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',2,'0001234-56.2026.8.16.0001','Trabalhista','Ação trabalhista colaborador X','Colaborador X','Ana Responsável','Dr. Advogado','em_andamento','restrito','2026-12-10','3');
insert into public.juridico_prazos (processo_id,unidade_id,titulo,data_prazo,responsavel,status) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',2,'Apresentar defesa','2026-12-10 23:59:00-03','Ana Responsável','pendente');

COMMIT;

-- Conferência rápida
select 'unidades' as tabela, count(*) from public.unidades where id in (1,2,3)
union all select 'produtos no site', count(*) from public.produtos where status='ATIVO' and categoria<>'Insumos'
union all select 'lancamentos contabeis', count(*) from public.gestao_lancamentos_contabeis
union all select 'processos juridicos', count(*) from public.juridico_processos;
