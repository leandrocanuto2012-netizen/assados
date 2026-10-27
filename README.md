# Assados Nobre ERP

**Gestão integrada para operações de alimentação**, com painel web e backend em Node.js. O projeto reúne recursos para vendas, caixa, estoque, produção, financeiro, unidades, RH, atendimento e acompanhamento operacional.

> **Importante para compradores:** o painel contém módulos em diferentes estágios de implementação. Algumas telas e integrações podem ser demonstrativas ou depender de configuração e desenvolvimento adicional. Confira a seção [Escopo e integrações](#escopo-e-integrações) antes de contratar ou colocar o sistema em produção.

## Recursos do sistema

O painel apresenta áreas para:

- **Operação e vendas:** dashboard, caixa/PDV, comandas, pedidos, eventos e vendas
- **Produtos e produção:** catálogo, estoque, insumos, receitas, fichas técnicas e ordens de serviço
- **Gestão financeira:** tesouraria, contas, fluxo de caixa, remessas e relatórios
- **Pessoas e unidades:** funcionários, permissões, ponto, férias e documentos de RH
- **Relacionamento e suporte:** clientes, fidelidade, CRM, chamados e checklists
- **Administração:** controle de matriz/filiais, auditoria, segurança de acesso e backups

A disponibilidade operacional de cada módulo depende da configuração do banco de dados e do estágio de implementação da respectiva funcionalidade.

## Tecnologias

- Node.js 18 ou superior
- Express
- HTML, CSS e JavaScript
- Supabase como banco de dados opcional
- Arquivo JSON local como alternativa para desenvolvimento

## Requisitos

- Node.js 18+
- npm
- Projeto Supabase configurado para uso com banco remoto; ou ambiente local para avaliação

## Executar localmente

Na pasta do projeto:

```bash
npm install
npm start
```

O servidor usa a porta definida em `PORT`; se não estiver definida, inicia na porta `8080`. Abra `http://localhost:8080/` ou `http://localhost:8080/dashboard.html`.

Para modo local, sem Supabase, o backend usa `data.json`. A aplicação cria dados de demonstração quando não há dados locais.

### Credenciais de demonstração

O código inclui usuários e senhas iniciais de demonstração para desenvolvimento. **Não publique nem use essas credenciais em produção.** Substitua ou remova os usuários de demonstração antes de disponibilizar o sistema a clientes e defina senhas individuais e fortes.

## Configuração do ambiente

Use [`.env.example`](.env.example) como referência. Configure variáveis no ambiente de execução, como Render, ou em um arquivo `.env` local que não seja versionado.

Variáveis principais:

| Variável                                           | Finalidade                                                   |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `SUPABASE_URL`                                     | URL do projeto Supabase                                      |
| `SUPABASE_KEY`                                     | Chave privada usada pelo backend; nunca exponha no navegador |
| `ADMIN_EMAIL`                                      | Endereço para receber notificações administrativas           |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Configuração do envio de e-mail                              |
| `ADMIN_RECOVERY_TOKEN`                             | Token para operação administrativa de redefinição de senha   |
| `BACKUP_ADMIN_TOKEN`                               | Token para consultar ou solicitar backups                    |
| `BACKUP_ENABLED`                                   | Ativa backups automáticos quando definido como `true`        |
| `BACKUP_DIR`                                       | Diretório de armazenamento dos backups                       |
| `BACKUP_STORAGE_PERSISTENT`                        | Declara que o destino está em armazenamento persistente      |
| `BACKUP_INTERVAL_HOURS`                            | Intervalo entre backups automáticos                          |
| `BACKUP_RETENTION`                                 | Quantidade de backups mantidos                               |

Use tokens aleatórios fortes e diferentes para `ADMIN_RECOVERY_TOKEN` e `BACKUP_ADMIN_TOKEN`. Não coloque chaves, senhas ou tokens no código do navegador, no Git ou em documentação pública.

## Supabase

Para conectar o backend ao Supabase, configure `SUPABASE_URL` e `SUPABASE_KEY` no ambiente do servidor. O esquema principal do ERP deve estar criado no projeto Supabase. A migração disponível neste repositório, [sql/02-seguranca-backups.sql](sql/02-seguranca-backups.sql), adiciona as estruturas necessárias ao fluxo de segurança e backups.

Revise e aplique a migração no projeto Supabase correto antes de ativar os recursos relacionados. Faça primeiro a validação em um ambiente de teste.

## Segurança e recuperação de acesso

O backend implementa funcionalidades de proteção de login e recuperação administrativa, incluindo limite de tentativas, bloqueio temporário, registro de chamados de suporte e armazenamento de senha com `scrypt`. O fluxo de notificação por e-mail depende da configuração SMTP.

O reset administrativo usa `ADMIN_RECOVERY_TOKEN`. As rotas administrativas de backup usam `BACKUP_ADMIN_TOKEN`. Esses tokens devem ser enviados somente pelo servidor ou por ferramenta administrativa segura — nunca pelo HTML público.

> Antes de uma implantação comercial, faça uma revisão de segurança completa, incluindo autenticação e autorização de todas as rotas, gestão de sessão, permissões, proteção de dados pessoais e adequação à LGPD. A existência de recursos de segurança no código não substitui auditoria ou configuração segura.

## Backups

Quando habilitados, os backups são arquivos compactados `.json.gz`. Para usar armazenamento persistente no Render, crie um Persistent Disk e configure, por exemplo, `BACKUP_DIR=/var/data/backups` e `BACKUP_STORAGE_PERSISTENT=true`.

Rotas administrativas disponíveis:

- `GET /api/admin/backups` — consultar o estado e a lista de backups
- `POST /api/admin/backups/criar` — solicitar um backup manual

As duas rotas exigem o cabeçalho `x-backup-admin-token`. A retenção automática remove arquivos antigos conforme `BACKUP_RETENTION`. Teste periodicamente a restauração em ambiente separado; criar backups não garante, por si só, que a restauração funcionará.

## Deploy

O projeto pode ser executado em um serviço Node.js, incluindo Render:

1. Publique o código em um repositório privado ou autorizado.
2. Crie um serviço web Node.js e configure o comando de início `npm start`.
3. Configure as variáveis de ambiente no painel do provedor.
4. Configure Supabase e aplique as migrações necessárias.
5. Se habilitar backups locais, configure armazenamento persistente.
6. Valide login, permissões, operações críticas, e-mail e restauração de backup em ambiente de teste.

O sistema também pode iniciar sem Supabase, usando armazenamento JSON local. Esse modo é destinado a desenvolvimento e avaliação, não substitui uma estratégia de banco de dados e alta disponibilidade para produção.

## Escopo e integrações

- Os envios de e-mail exigem configuração SMTP válida.
- O envio de SMS não está integrado por padrão; requer contratação e configuração de provedor compatível.
- Integrações externas, como iFood, serviços fiscais, bancos, WhatsApp ou provedores de IA, podem exigir credenciais, homologação, contrato e implementação adicional.
- Algumas telas do painel contêm dados de exemplo, ações simuladas ou recursos que precisam ser conectados ao backend.
- O sistema não substitui validação contábil, fiscal, trabalhista ou jurídica. Confirme cálculos e obrigações legais com profissionais responsáveis antes do uso.

## Licenciamento comercial

O modelo de contrato está em [CONTRATO-LICENCA.md](CONTRATO-LICENCA.md). É uma minuta para preencher e revisar juridicamente antes de assinar ou entregar o código.

### Termos propostos para a licença do comprador

Este texto é um resumo informativo e deve ser incorporado a um contrato de licença assinado para produzir efeitos entre as partes. Salvo disposição diferente no contrato:

- **Posse e uso:** o comprador recebe uma cópia do código e o direito de mantê-la e utilizá-la sem limite de prazo, usuários ou instalações, para suas próprias operações.
- **Alterações:** o comprador pode estudar e modificar o código para uso próprio, sem precisar de autorização prévia. A titularidade do código original e dos direitos autorais não é transferida. O contrato deve definir expressamente os direitos sobre as alterações feitas pelo comprador.
- **Sem revenda ou distribuição:** não é permitido vender, sublicenciar, publicar, disponibilizar a terceiros, distribuir ou transferir o código-fonte, o sistema ou versões modificadas, no todo ou em parte, salvo autorização escrita do titular.
- **Aviso de alterações:** cada alteração feita pelo comprador deve ser comunicada ao titular por escrito, com data e resumo do que mudou. O aviso não exige enviar, publicar ou distribuir o código alterado e não depende de autorização prévia.
- **Registro de versões:** recomenda-se manter o repositório Git privado, com histórico de commits, datas, identificação dos responsáveis e cópias de segurança. O histórico ajuda a documentar versões, mas, sozinho, não comprova autoria ou impede alteração/exclusão; para prova mais robusta, considere commits assinados, tags assinadas e armazenamento independente.
- **Multas contratuais propostas:** em caso de distribuição ou revenda não autorizada, propõe-se multa de **100 (cem) vezes o valor da licença**. Para alteração não comunicada, propõe-se multa de **50 (cinquenta) vezes o valor da licença**. O contrato deve definir o valor-base, a forma de apuração, o procedimento de notificação e eventual prazo de correção. A validade e proporcionalidade dessas multas dependem da legislação aplicável e de análise jurídica; penalidades excessivas podem ser contestadas ou reduzidas.

As condições acima não substituem o contrato. Antes de vender ou entregar o código, identifique claramente o titular, o comprador, o preço-base da licença, a duração, os direitos concedidos, as restrições, o canal e o prazo para comunicar alterações, as consequências de descumprimento e os direitos sobre customizações. Componentes de terceiros continuam sujeitos às licenças próprias e podem não permitir as mesmas restrições.

## Suporte e personalização

Escopo de implantação, integrações, treinamento, manutenção e suporte devem ser definidos separadamente na proposta comercial ou no contrato de venda.
