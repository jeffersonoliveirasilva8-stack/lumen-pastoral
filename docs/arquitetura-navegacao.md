# Arquitetura de Navegação

## Objetivo
Separar claramente quatro domínios funcionais do sistema:

1. **Calendário Litúrgico**
   - Santos, festas, solenidades, memórias, observações.
   - Acesso global e rápido, com link no header e card no painel.
2. **Agenda Pastoral**
   - Reuniões, formações, retiros, ensaios, eventos especiais.
   - Módulo próprio para cadastrar e registrar presença.
3. **Escalas**
   - Distribuição ministerial, confirmação, indisponibilidades.
4. **Gestão / Personalização**
   - Configurações de regras, prioridades, pontuações, notificações.

---

## Fluxo de Navegação Proposto

### Menu lateral (desktop)
- Painel
- Escalas
- Formação / Eventos
- Agenda Pastoral
- Notificações
- Calendário Litúrgico
- Personalização

### Navegação inferior (mobile)
- Painel
- Escalas
- Agenda
- Liturgia
- Perfil

### Ações rápidas no header
- Ícone de calendário litúrgico global
- Acesso direto ao calendário completo a partir de qualquer página admin

---

## Páginas / Rotas

| Rota | Página | Função | Observações |
|---|---|---|---|
| `/painel` | `src/routes/_authenticated/painel.tsx` | Visão geral administrativa | KPI, liturgia do dia, próximos eventos, aniversariantes, insights inteligentes |
| `/escalas` | `src/routes/_authenticated/escalas.tsx` | Gestão de escalas | Escalas e distribuição ministerial |
| `/formacoes` | `src/routes/_authenticated/formacoes.tsx` | Formações e eventos | Cadastro de eventos, presenças, pontuação |
| `/planejamento` | `src/routes/_authenticated/planejamento.tsx` | Agenda Pastoral | Calendário e linha do tempo pastoral |
| `/calendario` | `src/routes/_authenticated/calendario.tsx` | Calendário Litúrgico completo | Múltiplas celebrações por dia, detalhe litúrgico |
| `/notificacoes` | `src/routes/_authenticated/notificacoes.tsx` | Central de notificações | Avisos, conflitos, alertas |
| `/configuracoes/paroquia` | `src/routes/_authenticated/configuracoes.paroquia.tsx` | Configurações | Regras de escala, prioridades, pontuação |
| `/membros` | `src/routes/_authenticated/membros.tsx` | Gestão de membros | Tipo de acesso, prioridade, perfil |

---

## Domínios e responsabilidades

### 1. Calendário Litúrgico
- Página principal: `/calendario`
- Deve suportar:
  - múltiplas celebrações por dia
  - prioridade litúrgica
  - calendário romano, brasileiro, diocesano, paroquial
  - memórias facultativas, santos locais, comemorações, observações
- Exibir seções como:
  - Tempo litúrgico atual
  - Solenidades do mês
  - Lista completa do mês
  - Detalhes do dia com todas as celebrações

### 2. Agenda Pastoral
- Página principal: `/planejamento`
- Deve incluir:
  - visão mensal
  - linha do tempo / lista
  - registros de reuniões, formações, retiros, ensaios, eventos especiais
- Dentro do módulo:
  - registro de presenças
  - marcação de presença / falta / justificativa / atraso
  - pontuação automática conforme regras

### 3. Escalas
- Página principal: `/escalas`
- Responsável por distribuição e acompanhamento ministerial
- Deve refletir:
  - escalas futuras
  - status de implantação
  - modo de confirmação ativa vs escala fixa
  - indisponibilidades e conflitos

### 4. Gestão / Configuração
- Página principal: `/configuracoes/paroquia`
- Deve conter:
  - Regras de confirmação de escala
  - Prioridades e pesos de escala
  - Pontuação configurável
  - Tipos de acesso e roles
  - Central de notificações e ocorrências

---

## Tabelas novas / previstas

- `tipos_prioridade`
- `formacoes_eventos`
- `presencas_eventos`
- `ocorrencias_escala`
- `notificacoes`
- (já existente) `membros` com `prioridade_id` e `tipo_acesso`
- `paroquias` com `pontuacao_config`

---

## Páginas criadas / alteradas

- `src/routes/_authenticated/painel.tsx`
- `src/routes/_authenticated/calendario.tsx`
- `src/routes/_authenticated/planejamento.tsx`
- `src/routes/_authenticated/formacoes.tsx`
- `src/routes/_authenticated/notificacoes.tsx`
- `src/routes/_authenticated/configuracoes.paroquia.tsx`
- `src/routes/_authenticated/membros.tsx`
- `src/routes/_authenticated.tsx`
- `src/routes/portal-membro/escalas.tsx`

---

## Wireframe textual da estrutura

### Painel
- Header com título e breadcrumbs
- Card principal: Liturgia de Hoje
- Cards secundários: próximas escalas, próximos eventos, aniversariantes, taxa de preenchimento, alertas
- Sidebar / mobile nav com acesso rápido a Liturgia, Agenda, Escalas

### Calendário Litúrgico
- Navegação por mês
- Grid de dias com indicadores de celebrações
- Lateral com solenidades do mês e lista de celebrações
- Modal de detalhe do dia com:
  - celebrações múltiplas
  - grau litúrgico
  - origem (romano/diocesano/paroquial)
  - observações e santos locais

### Agenda Pastoral
- Seletor de view: mês / lista
- Calendário mensal com eventos e formações
- Painel de detalhes do evento com presença
- Botões de ação para criar evento e gestão de presença

### Escalas
- Lista de escalas futuras
- Indicador de status (publicada, pendente, incompleta)
- Modo de confirmação variável: ativa vs fixa
- Acesso a indisponibilidades e histórico de respostas

### Notificações
- Lista de avisos e alertas
- Filtros por tipo (aviso, alerta, urgente, sistema)
- Ações rápidas para marcar como lida

### Configuração
- Aba Regras de escala
- Aba Prioridades
- Aba Pontuação
- Aba Tipos de acesso / roles

---

## Próximos passos

1. Consolidar o componente `Liturgia de Hoje` no painel com navegação para `/calendario`.
2. Garantir que `/planejamento` seja tratado como agenda pastoral distinta de liturgia.
3. Sincronizar as tabelas de eventos e presenças com a interface de presença.
4. Refinar mobile nav para incluir Liturgia e Agenda em destaque.
5. Revisar o esquema de roles para diferenciar admin/coordenador/auxiliar/membro.
