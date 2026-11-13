'use strict';
/**
 * Estimador tributario gerencial - Assados Nobre ERP.
 * ESTIMATIVA para planejamento. Nao substitui apuracao do contador.
 * Tabelas do Simples Nacional (LC 123/2006) conferidas em fonte publica.
 */

const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// [limite superior RBT12, aliquota nominal, parcela a deduzir]
const SIMPLES = {
  I:   [[180000, .04, 0], [360000, .073, 5940], [720000, .095, 13860], [1800000, .107, 22500], [3600000, .143, 87300], [4800000, .19, 378000]],
  II:  [[180000, .045, 0], [360000, .078, 5940], [720000, .10, 13860], [1800000, .112, 22500], [3600000, .147, 85500], [4800000, .30, 720000]],
  III: [[180000, .06, 0], [360000, .112, 9360], [720000, .135, 17640], [1800000, .16, 35640], [3600000, .21, 125640], [4800000, .33, 648000]],
  IV:  [[180000, .045, 0], [360000, .09, 8100], [720000, .102, 12420], [1800000, .14, 39780], [3600000, .22, 183780], [4800000, .33, 828000]],
  V:   [[180000, .155, 0], [360000, .18, 4500], [720000, .195, 9900], [1800000, .205, 17100], [3600000, .23, 62100], [4800000, .305, 540000]]
};
const LIMITE_SIMPLES = 4800000;

// Atividade -> anexo e presuncao do Presumido
const ATIVIDADES = {
  comercio:  { rotulo: 'Comércio (padaria, revenda)', anexo: 'I',   presIRPJ: .08, presCSLL: .12, imposto: 'ICMS' },
  industria: { rotulo: 'Indústria (fabricação própria)', anexo: 'II',  presIRPJ: .08, presCSLL: .12, imposto: 'ICMS' },
  servico:   { rotulo: 'Serviço (encomenda, buffet)', anexo: 'III', presIRPJ: .32, presCSLL: .32, imposto: 'ISS' }
};

function aliquotaEfetivaSimples(anexo, rbt12) {
  const tabela = SIMPLES[anexo];
  if (!tabela) throw new Error('Anexo inválido');
  if (!(rbt12 > 0)) return { faixa: 1, nominal: tabela[0][1], efetiva: tabela[0][1], deduzir: 0 };
  if (rbt12 > LIMITE_SIMPLES) return null;
  let i = tabela.findIndex(f => rbt12 <= f[0]);
  const [, nominal, deduzir] = tabela[i];
  const efetiva = ((rbt12 * nominal) - deduzir) / rbt12;
  return { faixa: i + 1, nominal, efetiva, deduzir };
}

/** Simples: o DAS unico ja embute ICMS/ISS/PIS/COFINS/IRPJ/CSLL/CPP. */
function simples({ receitaMes, rbt12, atividade }) {
  const a = ATIVIDADES[atividade];
  const ef = aliquotaEfetivaSimples(a.anexo, rbt12);
  if (!ef) return { regime: 'simples', elegivel: false, motivo: 'RBT12 acima de R$ 4,8 milhões: fora do Simples.', total: null };
  const das = r2(receitaMes * ef.efetiva);
  return {
    regime: 'simples', elegivel: true, anexo: a.anexo, faixa: ef.faixa,
    aliquota_nominal: r2(ef.nominal * 100), aliquota_efetiva: Number((ef.efetiva * 100).toFixed(2)),
    total: das, carga_percentual: Number((ef.efetiva * 100).toFixed(2)),
    detalhe: [{ imposto: 'DAS (guia única: ICMS/ISS, PIS, COFINS, IRPJ, CSLL, CPP)', valor: das }]
  };
}

/** Presumido: IRPJ 15% + adicional 10% (acima de 20k/mes de base), CSLL 9%, PIS 0,65%, COFINS 3%, + ICMS ou ISS. */
function presumido({ receitaMes, atividade, icmsPct = 18, issPct = 5, aliqIcmsEfetiva }) {
  const a = ATIVIDADES[atividade];
  const baseIRPJ = receitaMes * a.presIRPJ;
  const baseCSLL = receitaMes * a.presCSLL;
  const irpj = baseIRPJ * .15;
  const adicional = Math.max(0, baseIRPJ - 20000) * .10;
  const csll = baseCSLL * .09;
  const pis = receitaMes * .0065;
  const cofins = receitaMes * .03;
  const detalhe = [
    { imposto: 'IRPJ (15% sobre lucro presumido)', valor: r2(irpj) },
    { imposto: 'Adicional IRPJ (10% acima de R$ 20 mil/mês)', valor: r2(adicional) },
    { imposto: 'CSLL (9%)', valor: r2(csll) },
    { imposto: 'PIS (0,65%)', valor: r2(pis) },
    { imposto: 'COFINS (3%)', valor: r2(cofins) }
  ];
  let estadual = 0;
  if (a.imposto === 'ISS') { estadual = receitaMes * (issPct / 100); detalhe.push({ imposto: `ISS (${issPct}%)`, valor: r2(estadual) }); }
  else {
    const p = aliqIcmsEfetiva != null ? aliqIcmsEfetiva : icmsPct;
    estadual = receitaMes * (p / 100); detalhe.push({ imposto: `ICMS (${p}% sobre a venda; sem créditos)`, valor: r2(estadual) });
  }
  const total = irpj + adicional + csll + pis + cofins + estadual;
  return { regime: 'presumido', elegivel: true, total: r2(total), carga_percentual: Number(((total / receitaMes) * 100).toFixed(2)), detalhe };
}

/** Real: PIS 1,65% e COFINS 7,6% nao cumulativos (com credito), IRPJ/CSLL sobre lucro contabil. */
function real({ receitaMes, atividade, despesasMes = 0, comprasMes = 0, icmsPct = 18, issPct = 5, creditoIcmsPct = 0 }) {
  const a = ATIVIDADES[atividade];
  const lucro = Math.max(0, receitaMes - despesasMes - comprasMes);
  const baseCred = comprasMes + despesasMes * 0.5; // premissa: metade das despesas gera credito
  const pis = Math.max(0, receitaMes * .0165 - baseCred * .0165);
  const cofins = Math.max(0, receitaMes * .076 - baseCred * .076);
  const irpj = lucro * .15;
  const adicional = Math.max(0, lucro - 20000) * .10;
  const csll = lucro * .09;
  const detalhe = [
    { imposto: 'IRPJ (15% sobre lucro real)', valor: r2(irpj) },
    { imposto: 'Adicional IRPJ (10% acima de R$ 20 mil/mês)', valor: r2(adicional) },
    { imposto: 'CSLL (9% sobre lucro real)', valor: r2(csll) },
    { imposto: 'PIS não cumulativo (1,65%, com créditos)', valor: r2(pis) },
    { imposto: 'COFINS não cumulativo (7,6%, com créditos)', valor: r2(cofins) }
  ];
  let estadual;
  if (a.imposto === 'ISS') { estadual = receitaMes * (issPct / 100); detalhe.push({ imposto: `ISS (${issPct}%)`, valor: r2(estadual) }); }
  else {
    const debito = receitaMes * (icmsPct / 100);
    const credito = comprasMes * (creditoIcmsPct / 100);
    estadual = Math.max(0, debito - credito);
    detalhe.push({ imposto: `ICMS (${icmsPct}% menos créditos de ${creditoIcmsPct}% das compras)`, valor: r2(estadual) });
  }
  const total = irpj + adicional + csll + pis + cofins + estadual;
  return { regime: 'real', elegivel: true, total: r2(total), carga_percentual: Number(((total / receitaMes) * 100).toFixed(2)), detalhe };
}

/** Compara os 3 regimes e gera o aviso de economia + estrategia (EDRAS). */
function estimar(entrada) {
  const e = { icmsPct: 18, issPct: 5, despesasMes: 0, comprasMes: 0, creditoIcmsPct: 0, ...entrada };
  if (!(e.receitaMes > 0)) throw new Error('Informe a receita mensal.');
  if (!ATIVIDADES[e.atividade]) throw new Error('Atividade inválida.');
  e.rbt12 = Number(e.rbt12) > 0 ? Number(e.rbt12) : e.receitaMes * 12;

  const regimes = { simples: simples(e), presumido: presumido(e), real: real(e) };
  const validos = Object.values(regimes).filter(r => r.elegivel && r.total != null);
  const melhor = validos.reduce((a, b) => (b.total < a.total ? b : a));
  const atual = regimes[e.regimeAtual] && regimes[e.regimeAtual].elegivel ? regimes[e.regimeAtual] : null;

  let aviso = null;
  if (atual && melhor.regime !== atual.regime) {
    const economiaMes = r2(atual.total - melhor.total);
    aviso = {
      pode_reduzir: economiaMes > 0.5,
      economia_mensal: economiaMes, economia_anual: r2(economiaMes * 12),
      de: atual.regime, para: melhor.regime,
      texto: `Pelas premissas informadas, migrar de ${nomeRegime(atual.regime)} para ${nomeRegime(melhor.regime)} reduziria cerca de R$ ${economiaMes.toFixed(2).replace('.', ',')} por mês (R$ ${(economiaMes * 12).toFixed(2).replace('.', ',')} por ano).`
    };
  } else if (atual) {
    aviso = { pode_reduzir: false, economia_mensal: 0, economia_anual: 0, de: atual.regime, para: atual.regime, texto: `Com os dados informados, ${nomeRegime(atual.regime)} já é o regime mais econômico entre os três.` };
  }
  return { entrada: { receitaMes: e.receitaMes, rbt12: e.rbt12, atividade: e.atividade, regimeAtual: e.regimeAtual || null }, regimes, melhor_regime: melhor.regime, aviso, estrategia: estrategia(e, regimes, melhor), avisos_legais: AVISOS };
}

const nomeRegime = r => ({ simples: 'Simples Nacional', presumido: 'Lucro Presumido', real: 'Lucro Real' }[r] || r);

const AVISOS = [
  'Estimativa gerencial com as premissas informadas. Não é apuração oficial nem substitui o contador.',
  'Mudança de regime tem prazo e regras: a opção pelo Simples Nacional é feita até setembro do ano anterior (regra da transição da reforma tributária); Presumido e Real são definidos no primeiro pagamento do ano.',
  'ICMS e ISS variam por estado e município, e há substituição tributária em vários produtos de padaria. Confirme as alíquotas com seu contador.',
  'A reforma tributária (IBS e CBS) está em transição e pode alterar essas contas nos próximos anos.'
];

/** Estrategia do EDRAS: recomendacoes objetivas a partir dos numeros. */
function estrategia(e, regimes, melhor) {
  const dicas = [];
  const s = regimes.simples;
  if (s.elegivel) {
    const folgaPct = ((LIMITE_SIMPLES - e.rbt12) / LIMITE_SIMPLES) * 100;
    dicas.push(`Seu RBT12 estimado é R$ ${e.rbt12.toLocaleString('pt-BR')}, na faixa ${s.faixa} do Anexo ${s.anexo}. Falta ${folgaPct.toFixed(0)}% de margem até o teto do Simples (R$ 4,8 milhões).`);
    if (e.rbt12 > LIMITE_SIMPLES * 0.85) dicas.push('Atenção: você está perto do limite do Simples. Planeje a transição para Presumido ou Real antes de estourar o teto.');
  } else dicas.push('Sua receita ultrapassa o teto do Simples. Compare apenas Presumido e Real.');
  if (melhor.regime === 'simples') dicas.push('O Simples está vencendo: guia única, menos burocracia e carga efetiva mais baixa nas faixas iniciais.');
  if (melhor.regime === 'presumido') dicas.push('O Presumido está vencendo: vale quando a margem real é maior que a presunção (8% sobre a receita no comércio).');
  if (melhor.regime === 'real') dicas.push('O Real está vencendo: faz sentido quando a margem é baixa ou há muitos créditos de PIS/COFINS nas compras.');
  if (regimes.real.elegivel && e.comprasMes === 0) dicas.push('Informe suas compras do mês: no Lucro Real elas geram crédito de PIS/COFINS e podem baixar bastante o imposto.');
  if (e.atividade === 'comercio') dicas.push('Se você fabrica o que vende (pão, bolo, salgado), confirme com o contador se parte da receita entra como indústria (Anexo II).');
  dicas.push('Separe as receitas de produtos com substituição tributária de ICMS: no Simples essa parcela sai do DAS e reduz a carga.');
  dicas.push('Leve essa simulação ao seu contador e peça o cálculo oficial antes de decidir qualquer mudança.');
  return dicas;
}

module.exports = { estimar, simples, presumido, real, aliquotaEfetivaSimples, ATIVIDADES, SIMPLES, LIMITE_SIMPLES };
