-- Adiciona flag `solene` em tipos_missa.
-- Quando true, escalas geradas para esse tipo ativam automaticamente
-- modo_selecao='merito' e solene=true no motor de escalas.

alter table tipos_missa
  add column if not exists solene boolean not null default false;
