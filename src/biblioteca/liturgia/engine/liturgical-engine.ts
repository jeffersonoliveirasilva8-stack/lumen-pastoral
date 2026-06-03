import type { LiturgicalDayRecord, LiturgicalRank, LiturgicalResolution } from '../types';
import { RANK_WEIGHT } from '../constants/ranks';

// ─── Tabela de celebrações fixas do calendário romano ────────────────────────

import { getMovableFeasts } from './movable-feasts';
import { getLiturgicalSeason } from './seasons';

interface FixedFeast {
  month: number;
  day: number;
  titulo: string;
  subtitulo?: string;
  grau: LiturgicalRank;
  cor: import('../types').LiturgicalColor;
  santo?: string;
  e_dia_preceito?: boolean;
  e_solene?: boolean;
}

const FIXED_FEASTS: FixedFeast[] = [
  // ── Janeiro ──────────────────────────────────────────────────────────────────
  { month: 1,  day: 1,  titulo: 'Santa Maria, Mãe de Deus',                        grau: 'solenidade',          cor: 'branco',   e_dia_preceito: true, e_solene: true },
  { month: 1,  day: 2,  titulo: 'SS. Basílio Magno e Gregório Nazianzeno',          grau: 'memorial',            cor: 'branco' },
  { month: 1,  day: 3,  titulo: 'Santíssimo Nome de Jesus',                         grau: 'memorial_facultativo', cor: 'branco' },
  { month: 1,  day: 6,  titulo: 'Epifania do Senhor',                               grau: 'solenidade',          cor: 'branco',   e_dia_preceito: true },
  { month: 1,  day: 7,  titulo: 'São Raimundo de Penhafort',                        grau: 'memorial_facultativo', cor: 'branco' },
  { month: 1,  day: 13, titulo: 'São Hilário',                                      grau: 'memorial_facultativo', cor: 'branco' },
  { month: 1,  day: 17, titulo: 'Santo Antônio Abade',                              grau: 'memorial',            cor: 'branco' },
  { month: 1,  day: 20, titulo: 'São Sebastião',                                    grau: 'memorial',            cor: 'vermelho' },
  { month: 1,  day: 21, titulo: 'Santa Inês',                                       grau: 'memorial',            cor: 'vermelho' },
  { month: 1,  day: 22, titulo: 'São Vicente Diácono',                              grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 1,  day: 24, titulo: 'São Francisco de Sales',                           grau: 'memorial',            cor: 'branco' },
  { month: 1,  day: 25, titulo: 'Conversão de São Paulo',                           grau: 'festa',               cor: 'branco',   santo: 'São Paulo Apóstolo' },
  { month: 1,  day: 26, titulo: 'SS. Timóteo e Tito',                               grau: 'memorial',            cor: 'branco' },
  { month: 1,  day: 27, titulo: 'Santa Ângela Mérici',                              grau: 'memorial_facultativo', cor: 'branco' },
  { month: 1,  day: 28, titulo: 'São Tomás de Aquino',                              grau: 'memorial',            cor: 'branco' },
  { month: 1,  day: 31, titulo: 'São João Bosco',                                   grau: 'memorial',            cor: 'branco' },
  // ── Fevereiro ────────────────────────────────────────────────────────────────
  { month: 2,  day: 2,  titulo: 'Apresentação do Senhor',                           grau: 'festa',               cor: 'branco' },
  { month: 2,  day: 3,  titulo: 'São Brás',                                         grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 2,  day: 5,  titulo: 'Santa Ágata',                                      grau: 'memorial',            cor: 'vermelho' },
  { month: 2,  day: 6,  titulo: 'SS. Paulo Miki e Companheiros',                    grau: 'memorial',            cor: 'vermelho' },
  { month: 2,  day: 8,  titulo: 'São Jerônimo Emiliani',                            grau: 'memorial_facultativo', cor: 'branco' },
  { month: 2,  day: 10, titulo: 'Santa Escolástica',                                grau: 'memorial',            cor: 'branco' },
  { month: 2,  day: 11, titulo: 'Nossa Senhora de Lourdes',                         grau: 'memorial',            cor: 'branco' },
  { month: 2,  day: 14, titulo: 'SS. Cirilo e Metódio',                             grau: 'memorial',            cor: 'branco' },
  { month: 2,  day: 17, titulo: 'Sete Fundadores da Ordem dos Servitas',            grau: 'memorial_facultativo', cor: 'branco' },
  { month: 2,  day: 21, titulo: 'São Pedro Damião',                                 grau: 'memorial_facultativo', cor: 'branco' },
  { month: 2,  day: 22, titulo: 'Cátedra de São Pedro',                             grau: 'festa',               cor: 'branco',   santo: 'São Pedro Apóstolo' },
  { month: 2,  day: 23, titulo: 'São Policarpo',                                    grau: 'memorial',            cor: 'vermelho' },
  // ── Março ────────────────────────────────────────────────────────────────────
  { month: 3,  day: 4,  titulo: 'São Casimiro',                                     grau: 'memorial_facultativo', cor: 'branco' },
  { month: 3,  day: 7,  titulo: 'SS. Perpétua e Felicidade',                        grau: 'memorial',            cor: 'vermelho' },
  { month: 3,  day: 8,  titulo: 'São João de Deus',                                 grau: 'memorial_facultativo', cor: 'branco' },
  { month: 3,  day: 9,  titulo: 'Santa Francisca Romana',                           grau: 'memorial_facultativo', cor: 'branco' },
  { month: 3,  day: 17, titulo: 'São Patrício',                                     grau: 'memorial_facultativo', cor: 'branco' },
  { month: 3,  day: 18, titulo: 'São Cirilo de Jerusalém',                          grau: 'memorial_facultativo', cor: 'branco' },
  { month: 3,  day: 19, titulo: 'São José',                                         grau: 'solenidade',          cor: 'branco',   santo: 'São José', e_dia_preceito: true, e_solene: true },
  { month: 3,  day: 23, titulo: 'São Turíbio de Mogrovejo',                         grau: 'memorial_facultativo', cor: 'branco' },
  { month: 3,  day: 25, titulo: 'Anunciação do Senhor',                             grau: 'solenidade',          cor: 'branco',   e_dia_preceito: true },
  // ── Abril ────────────────────────────────────────────────────────────────────
  { month: 4,  day: 2,  titulo: 'São Francisco de Paula',                           grau: 'memorial_facultativo', cor: 'branco' },
  { month: 4,  day: 4,  titulo: 'São Isidoro de Sevilha',                           grau: 'memorial_facultativo', cor: 'branco' },
  { month: 4,  day: 5,  titulo: 'São Vicente Ferrer',                               grau: 'memorial_facultativo', cor: 'branco' },
  { month: 4,  day: 7,  titulo: 'São João Batista de La Salle',                     grau: 'memorial',            cor: 'branco' },
  { month: 4,  day: 11, titulo: 'São Estanislau',                                   grau: 'memorial',            cor: 'vermelho' },
  { month: 4,  day: 13, titulo: 'São Martinho I',                                   grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 4,  day: 23, titulo: 'São Jorge',                                        grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 4,  day: 24, titulo: 'São Fidélis de Sigmaringa',                        grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 4,  day: 25, titulo: 'São Marcos Evangelista',                           grau: 'festa',               cor: 'vermelho', santo: 'São Marcos' },
  { month: 4,  day: 28, titulo: 'São Pedro Chanel',                                 grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 4,  day: 29, titulo: 'Santa Catarina de Siena',                          grau: 'memorial',            cor: 'branco' },
  { month: 4,  day: 30, titulo: 'São Pio V',                                        grau: 'memorial_facultativo', cor: 'branco' },
  // ── Maio ─────────────────────────────────────────────────────────────────────
  { month: 5,  day: 1,  titulo: 'São José Operário',                                grau: 'memorial',            cor: 'branco',   santo: 'São José' },
  { month: 5,  day: 2,  titulo: 'São Atanásio',                                     grau: 'memorial',            cor: 'branco' },
  { month: 5,  day: 3,  titulo: 'SS. Filipe e Tiago Apóstolos',                     grau: 'festa',               cor: 'vermelho' },
  { month: 5,  day: 13, titulo: 'Nossa Senhora de Fátima',                          grau: 'memorial',            cor: 'branco' },
  { month: 5,  day: 14, titulo: 'São Matias Apóstolo',                              grau: 'festa',               cor: 'vermelho' },
  { month: 5,  day: 18, titulo: 'São João I',                                       grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 5,  day: 20, titulo: 'São Bernardino de Siena',                          grau: 'memorial_facultativo', cor: 'branco' },
  { month: 5,  day: 21, titulo: 'São Cristóvão Magallanes e Companheiros',          grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 5,  day: 22, titulo: 'Santa Rita de Cássia',                             grau: 'memorial_facultativo', cor: 'branco' },
  { month: 5,  day: 25, titulo: 'São Beda Venerável',                               grau: 'memorial_facultativo', cor: 'branco' },
  { month: 5,  day: 26, titulo: 'São Filipe Neri',                                  grau: 'memorial',            cor: 'branco' },
  { month: 5,  day: 27, titulo: 'Santo Agostinho de Cantuária',                     grau: 'memorial_facultativo', cor: 'branco' },
  { month: 5,  day: 31, titulo: 'Visitação de Nossa Senhora',                       grau: 'festa',               cor: 'branco' },
  // ── Junho ────────────────────────────────────────────────────────────────────
  { month: 6,  day: 1,  titulo: 'São Justino',                                      grau: 'memorial',            cor: 'vermelho' },
  { month: 6,  day: 2,  titulo: 'SS. Marcelino e Pedro',                            grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 6,  day: 3,  titulo: 'São Carlos Lwanga e Companheiros',                 grau: 'memorial',            cor: 'vermelho' },
  { month: 6,  day: 5,  titulo: 'São Bonifácio',                                    grau: 'memorial',            cor: 'vermelho' },
  { month: 6,  day: 6,  titulo: 'São Norberto',                                     grau: 'memorial_facultativo', cor: 'branco' },
  { month: 6,  day: 9,  titulo: 'São Efrém',                                        grau: 'memorial_facultativo', cor: 'branco' },
  { month: 6,  day: 11, titulo: 'São Barnabé Apóstolo',                             grau: 'memorial',            cor: 'vermelho' },
  { month: 6,  day: 13, titulo: 'Santo Antônio de Pádua',                           grau: 'memorial',            cor: 'branco' },
  { month: 6,  day: 19, titulo: 'São Romualdo',                                     grau: 'memorial_facultativo', cor: 'branco' },
  { month: 6,  day: 21, titulo: 'São Luís Gonzaga',                                 grau: 'memorial',            cor: 'branco' },
  { month: 6,  day: 22, titulo: 'São Paulino de Nola',                              grau: 'memorial_facultativo', cor: 'branco' },
  { month: 6,  day: 24, titulo: 'Nascimento de São João Batista',                   grau: 'solenidade',          cor: 'branco',   santo: 'São João Batista', e_solene: true },
  { month: 6,  day: 27, titulo: 'São Cirilo de Alexandria',                         grau: 'memorial_facultativo', cor: 'branco' },
  { month: 6,  day: 28, titulo: 'São Ireneu de Lyon',                               grau: 'memorial',            cor: 'vermelho' },
  { month: 6,  day: 29, titulo: 'São Pedro e São Paulo, Apóstolos',                 grau: 'solenidade',          cor: 'vermelho', e_dia_preceito: true, e_solene: true },
  { month: 6,  day: 30, titulo: 'Primeiros Mártires da Igreja Romana',              grau: 'memorial_facultativo', cor: 'vermelho' },
  // ── Julho ────────────────────────────────────────────────────────────────────
  { month: 7,  day: 3,  titulo: 'São Tomé Apóstolo',                               grau: 'festa',               cor: 'vermelho' },
  { month: 7,  day: 4,  titulo: 'Santa Isabel de Portugal',                         grau: 'memorial_facultativo', cor: 'branco' },
  { month: 7,  day: 5,  titulo: 'Santo Antônio Maria Zaccaria',                     grau: 'memorial_facultativo', cor: 'branco' },
  { month: 7,  day: 6,  titulo: 'Santa Maria Goretti',                              grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 7,  day: 9,  titulo: 'São Agostinho Zhao Rong e Companheiros',           grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 7,  day: 11, titulo: 'São Bento',                                        grau: 'memorial',            cor: 'branco' },
  { month: 7,  day: 13, titulo: 'São Henrique',                                     grau: 'memorial_facultativo', cor: 'branco' },
  { month: 7,  day: 14, titulo: 'São Camilo de Lélis',                              grau: 'memorial_facultativo', cor: 'branco' },
  { month: 7,  day: 15, titulo: 'São Boaventura',                                   grau: 'memorial',            cor: 'branco' },
  { month: 7,  day: 16, titulo: 'Nossa Senhora do Carmo',                           grau: 'memorial',            cor: 'branco' },
  { month: 7,  day: 20, titulo: 'São Apolinário',                                   grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 7,  day: 21, titulo: 'São Lourenço de Brindisi',                         grau: 'memorial_facultativo', cor: 'branco' },
  { month: 7,  day: 22, titulo: 'Santa Maria Madalena',                             grau: 'festa',               cor: 'branco',   santo: 'Santa Maria Madalena' },
  { month: 7,  day: 23, titulo: 'Santa Brígida da Suécia',                          grau: 'memorial_facultativo', cor: 'branco' },
  { month: 7,  day: 25, titulo: 'São Tiago Apóstolo',                               grau: 'festa',               cor: 'vermelho' },
  { month: 7,  day: 26, titulo: 'SS. Joaquim e Ana',                                grau: 'memorial',            cor: 'branco' },
  { month: 7,  day: 29, titulo: 'Santa Marta, Maria e Lázaro',                      grau: 'memorial',            cor: 'branco' },
  { month: 7,  day: 30, titulo: 'São Pedro Crisólogo',                              grau: 'memorial_facultativo', cor: 'branco' },
  { month: 7,  day: 31, titulo: 'Santo Inácio de Loyola',                           grau: 'memorial',            cor: 'branco' },
  // ── Agosto ───────────────────────────────────────────────────────────────────
  { month: 8,  day: 1,  titulo: 'Santo Afonso Maria de Ligório',                    grau: 'memorial',            cor: 'branco' },
  { month: 8,  day: 2,  titulo: 'São Pedro Julião Eymard',                          grau: 'memorial_facultativo', cor: 'branco' },
  { month: 8,  day: 4,  titulo: 'São João Maria Vianney',                           grau: 'memorial',            cor: 'branco' },
  { month: 8,  day: 5,  titulo: 'Dedicação da Basílica de Santa Maria Maior',       grau: 'memorial_facultativo', cor: 'branco' },
  { month: 8,  day: 6,  titulo: 'Transfiguração do Senhor',                         grau: 'festa',               cor: 'branco' },
  { month: 8,  day: 7,  titulo: 'SS. Sisto II e Companheiros',                      grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 8,  day: 8,  titulo: 'São Domingos de Gusmão',                           grau: 'memorial',            cor: 'branco' },
  { month: 8,  day: 9,  titulo: 'Santa Teresa Benedita da Cruz',                    grau: 'memorial',            cor: 'vermelho' },
  { month: 8,  day: 10, titulo: 'São Lourenço',                                     grau: 'festa',               cor: 'vermelho' },
  { month: 8,  day: 11, titulo: 'Santa Clara',                                      grau: 'memorial',            cor: 'branco' },
  { month: 8,  day: 12, titulo: 'Santa Joana Francisca de Chantal',                 grau: 'memorial_facultativo', cor: 'branco' },
  { month: 8,  day: 13, titulo: 'SS. Poncianos e Hipólito',                         grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 8,  day: 14, titulo: 'São Maximiliano Maria Kolbe',                      grau: 'memorial',            cor: 'vermelho' },
  { month: 8,  day: 15, titulo: 'Assunção de Nossa Senhora',                        grau: 'solenidade',          cor: 'branco',   e_dia_preceito: true, e_solene: true },
  { month: 8,  day: 16, titulo: 'São Estêvão da Hungria',                           grau: 'memorial_facultativo', cor: 'branco' },
  { month: 8,  day: 19, titulo: 'São João Eudes',                                   grau: 'memorial_facultativo', cor: 'branco' },
  { month: 8,  day: 20, titulo: 'São Bernardo',                                     grau: 'memorial',            cor: 'branco' },
  { month: 8,  day: 21, titulo: 'São Pio X',                                        grau: 'memorial',            cor: 'branco' },
  { month: 8,  day: 22, titulo: 'Santa Maria, Rainha',                              grau: 'memorial',            cor: 'branco' },
  { month: 8,  day: 23, titulo: 'Santa Rosa de Lima',                               grau: 'memorial_facultativo', cor: 'branco' },
  { month: 8,  day: 24, titulo: 'São Bartolomeu Apóstolo',                          grau: 'festa',               cor: 'vermelho' },
  { month: 8,  day: 25, titulo: 'São Luís Rei de França',                           grau: 'memorial_facultativo', cor: 'branco' },
  { month: 8,  day: 27, titulo: 'Santa Mônica',                                     grau: 'memorial',            cor: 'branco' },
  { month: 8,  day: 28, titulo: 'Santo Agostinho',                                  grau: 'memorial',            cor: 'branco',   santo: 'Santo Agostinho' },
  { month: 8,  day: 29, titulo: 'Martírio de São João Batista',                     grau: 'memorial',            cor: 'vermelho' },
  // ── Setembro ─────────────────────────────────────────────────────────────────
  { month: 9,  day: 3,  titulo: 'São Gregório Magno',                               grau: 'memorial',            cor: 'branco' },
  { month: 9,  day: 8,  titulo: 'Natividade de Nossa Senhora',                      grau: 'festa',               cor: 'branco' },
  { month: 9,  day: 9,  titulo: 'São Pedro Claver',                                 grau: 'memorial_facultativo', cor: 'branco' },
  { month: 9,  day: 12, titulo: 'Santíssimo Nome de Maria',                         grau: 'memorial_facultativo', cor: 'branco' },
  { month: 9,  day: 13, titulo: 'São João Crisóstomo',                              grau: 'memorial',            cor: 'branco' },
  { month: 9,  day: 14, titulo: 'Exaltação da Santa Cruz',                          grau: 'festa',               cor: 'vermelho' },
  { month: 9,  day: 15, titulo: 'Nossa Senhora das Dores',                          grau: 'memorial',            cor: 'branco' },
  { month: 9,  day: 16, titulo: 'SS. Cornélio e Cipriano',                          grau: 'memorial',            cor: 'vermelho' },
  { month: 9,  day: 17, titulo: 'São Roberto Belarmino',                            grau: 'memorial_facultativo', cor: 'branco' },
  { month: 9,  day: 19, titulo: 'São Januário',                                     grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 9,  day: 20, titulo: 'SS. André Kim Taegon e Companheiros',              grau: 'memorial',            cor: 'vermelho' },
  { month: 9,  day: 21, titulo: 'São Mateus Apóstolo e Evangelista',                grau: 'festa',               cor: 'vermelho', santo: 'São Mateus' },
  { month: 9,  day: 23, titulo: 'São Pio de Pietrelcina',                           grau: 'memorial',            cor: 'branco' },
  { month: 9,  day: 26, titulo: 'SS. Cosme e Damião',                               grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 9,  day: 27, titulo: 'São Vicente de Paulo',                             grau: 'memorial',            cor: 'branco' },
  { month: 9,  day: 28, titulo: 'São Lourenço Ruiz e Companheiros',                 grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 9,  day: 29, titulo: 'SS. Miguel, Gabriel e Rafael, Arcanjos',           grau: 'festa',               cor: 'branco' },
  { month: 9,  day: 30, titulo: 'São Jerônimo',                                     grau: 'memorial',            cor: 'branco' },
  // ── Outubro ──────────────────────────────────────────────────────────────────
  { month: 10, day: 1,  titulo: 'Santa Teresinha do Menino Jesus',                  grau: 'memorial',            cor: 'branco',   santo: 'Santa Teresinha' },
  { month: 10, day: 2,  titulo: 'Santos Anjos Custódios',                           grau: 'memorial',            cor: 'branco' },
  { month: 10, day: 4,  titulo: 'São Francisco de Assis',                           grau: 'memorial',            cor: 'branco',   santo: 'São Francisco' },
  { month: 10, day: 6,  titulo: 'São Bruno',                                        grau: 'memorial_facultativo', cor: 'branco' },
  { month: 10, day: 7,  titulo: 'Nossa Senhora do Rosário',                         grau: 'memorial',            cor: 'branco' },
  { month: 10, day: 9,  titulo: 'SS. Dionísio e Companheiros',                      grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 10, day: 11, titulo: 'São João XXIII',                                   grau: 'memorial_facultativo', cor: 'branco' },
  { month: 10, day: 12, titulo: 'Nossa Senhora Aparecida',                          grau: 'solenidade',          cor: 'branco',   e_dia_preceito: true, e_solene: true },
  { month: 10, day: 14, titulo: 'São Calisto I',                                    grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 10, day: 15, titulo: 'Santa Teresa de Ávila',                            grau: 'memorial',            cor: 'branco' },
  { month: 10, day: 16, titulo: 'Santa Edviges',                                    grau: 'memorial_facultativo', cor: 'branco' },
  { month: 10, day: 17, titulo: 'São Inácio de Antioquia',                          grau: 'memorial',            cor: 'vermelho' },
  { month: 10, day: 18, titulo: 'São Lucas Evangelista',                            grau: 'festa',               cor: 'vermelho', santo: 'São Lucas' },
  { month: 10, day: 19, titulo: 'São Paulo da Cruz',                                grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 10, day: 22, titulo: 'São João Paulo II',                                grau: 'memorial_facultativo', cor: 'branco' },
  { month: 10, day: 23, titulo: 'São João de Capistrano',                           grau: 'memorial_facultativo', cor: 'branco' },
  { month: 10, day: 24, titulo: 'Santo Antônio Maria Claret',                       grau: 'memorial_facultativo', cor: 'branco' },
  { month: 10, day: 28, titulo: 'SS. Simão e Judas Tadeu, Apóstolos',               grau: 'festa',               cor: 'vermelho' },
  // ── Novembro ─────────────────────────────────────────────────────────────────
  { month: 11, day: 1,  titulo: 'Todos os Santos',                                  grau: 'solenidade',          cor: 'branco',   e_dia_preceito: true },
  { month: 11, day: 2,  titulo: 'Comemoração de Todos os Fiéis Defuntos',           grau: 'comemoracao',         cor: 'preto' },
  { month: 11, day: 3,  titulo: 'São Martinho de Porres',                           grau: 'memorial_facultativo', cor: 'branco' },
  { month: 11, day: 4,  titulo: 'São Carlos Borromeo',                              grau: 'memorial',            cor: 'branco' },
  { month: 11, day: 9,  titulo: 'Dedicação da Basílica de Latrão',                  grau: 'festa',               cor: 'branco' },
  { month: 11, day: 10, titulo: 'São Leão Magno',                                   grau: 'memorial',            cor: 'branco' },
  { month: 11, day: 11, titulo: 'São Martinho de Tours',                            grau: 'memorial',            cor: 'branco' },
  { month: 11, day: 12, titulo: 'São Josafá',                                       grau: 'memorial',            cor: 'vermelho' },
  { month: 11, day: 13, titulo: 'Santa Luísa de Marillac',                          grau: 'memorial_facultativo', cor: 'branco' },
  { month: 11, day: 15, titulo: 'São Alberto Magno',                                grau: 'memorial_facultativo', cor: 'branco' },
  { month: 11, day: 16, titulo: 'Santa Gertrudes',                                  grau: 'memorial_facultativo', cor: 'branco' },
  { month: 11, day: 17, titulo: 'Santa Isabel da Hungria',                          grau: 'memorial',            cor: 'branco' },
  { month: 11, day: 18, titulo: 'Dedicação das Basílicas dos SS. Pedro e Paulo',    grau: 'memorial_facultativo', cor: 'branco' },
  { month: 11, day: 21, titulo: 'Apresentação de Nossa Senhora no Templo',          grau: 'memorial',            cor: 'branco' },
  { month: 11, day: 22, titulo: 'Santa Cecília',                                    grau: 'memorial',            cor: 'vermelho' },
  { month: 11, day: 23, titulo: 'São Clemente I',                                   grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 11, day: 24, titulo: 'SS. André Dũng-Lạc e Companheiros',               grau: 'memorial',            cor: 'vermelho' },
  { month: 11, day: 25, titulo: 'Santa Catarina de Alexandria',                     grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 11, day: 30, titulo: 'São André Apóstolo',                               grau: 'festa',               cor: 'vermelho', santo: 'São André' },
  // ── Dezembro ─────────────────────────────────────────────────────────────────
  { month: 12, day: 3,  titulo: 'São Francisco Xavier',                             grau: 'memorial',            cor: 'branco' },
  { month: 12, day: 4,  titulo: 'São João Damasceno',                               grau: 'memorial_facultativo', cor: 'branco' },
  { month: 12, day: 6,  titulo: 'São Nicolau',                                      grau: 'memorial_facultativo', cor: 'branco' },
  { month: 12, day: 7,  titulo: 'Santo Ambrósio',                                   grau: 'memorial',            cor: 'branco' },
  { month: 12, day: 8,  titulo: 'Imaculada Conceição de Nossa Senhora',             grau: 'solenidade',          cor: 'branco',   e_dia_preceito: true, e_solene: true },
  { month: 12, day: 9,  titulo: 'São Juan Diego Cuauhtlatoatzin',                   grau: 'memorial_facultativo', cor: 'branco' },
  { month: 12, day: 11, titulo: 'São Dâmaso I',                                     grau: 'memorial_facultativo', cor: 'branco' },
  { month: 12, day: 12, titulo: 'Nossa Senhora de Guadalupe',                       grau: 'festa',               cor: 'branco' },
  { month: 12, day: 13, titulo: 'Santa Lúcia',                                      grau: 'memorial',            cor: 'vermelho' },
  { month: 12, day: 14, titulo: 'São João da Cruz',                                 grau: 'memorial',            cor: 'branco' },
  { month: 12, day: 21, titulo: 'São Pedro Canísio',                                grau: 'memorial_facultativo', cor: 'branco' },
  { month: 12, day: 23, titulo: 'São João de Kęty',                                 grau: 'memorial_facultativo', cor: 'branco' },
  { month: 12, day: 25, titulo: 'Natal do Senhor',                                  grau: 'solenidade',          cor: 'branco',   e_dia_preceito: true, e_solene: true },
  { month: 12, day: 26, titulo: 'São Estêvão, Primeiro Mártir',                     grau: 'festa',               cor: 'vermelho', santo: 'São Estêvão' },
  { month: 12, day: 27, titulo: 'São João Apóstolo e Evangelista',                  grau: 'festa',               cor: 'branco',   santo: 'São João' },
  { month: 12, day: 28, titulo: 'Santos Inocentes, Mártires',                       grau: 'festa',               cor: 'vermelho' },
  { month: 12, day: 29, titulo: 'São Tomás Becket',                                 grau: 'memorial_facultativo', cor: 'vermelho' },
  { month: 12, day: 31, titulo: 'São Silvestre I',                                  grau: 'memorial_facultativo', cor: 'branco' },
];

// ─── Calendário completo calculado ───────────────────────────────────────────

let _cache: Map<string, LiturgicalDayRecord[]> | null = null;
let _cacheYear: number | null = null;

function buildYearMap(year: number): Map<string, LiturgicalDayRecord[]> {
  const map = new Map<string, LiturgicalDayRecord[]>();

  const add = (rec: LiturgicalDayRecord) => {
    const list = map.get(rec.date) ?? [];
    list.push(rec);
    map.set(rec.date, list);
  };

  // Celebrações fixas
  for (const f of FIXED_FEASTS) {
    const date = `${year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
    add({
      date,
      titulo: f.titulo,
      subtitulo: f.subtitulo,
      santo: f.santo,
      grau: f.grau,
      cor: f.cor,
      tempo_liturgico: getLiturgicalSeason(new Date(date), year),
      e_dia_preceito: f.e_dia_preceito ?? false,
      e_solene: f.e_solene ?? false,
      origem: 'romano',
    });
  }

  // Celebrações móveis
  for (const rec of getMovableFeasts(year)) {
    add(rec);
  }

  return map;
}

function getYearMap(year: number): Map<string, LiturgicalDayRecord[]> {
  if (_cacheYear === year && _cache) return _cache;
  _cache = buildYearMap(year);
  _cacheYear = year;
  return _cache;
}

// ─── API pública ─────────────────────────────────────────────────────────────

/** Retorna todas as celebrações computadas para uma data (calendário romano). */
export function getComputedCelebrations(date: string): LiturgicalDayRecord[] {
  const year = parseInt(date.slice(0, 4), 10);
  return getYearMap(year).get(date) ?? [];
}

/**
 * Resolve o conflito entre múltiplas celebrações numa mesma data.
 * Regras: solenidade > festa > memorial > memorial_facultativo > comemoracao.
 * Celebrações diocesanas/paroquiais podem sobrescrever celebrações comuns,
 * mas NÃO podem sobrescrever solenidades universais.
 */
export function resolveCelebrations(
  celebrations: LiturgicalDayRecord[]
): LiturgicalResolution | null {
  if (celebrations.length === 0) return null;

  // Ordena por peso descendente, depois por origem (paroquial > diocesano > romano)
  const ORIGIN_WEIGHT: Record<string, number> = { paroquial: 3, diocesano: 2, romano: 1 };

  const sorted = [...celebrations].sort((a, b) => {
    const weightDiff = (RANK_WEIGHT[b.grau] ?? 0) - (RANK_WEIGHT[a.grau] ?? 0);
    if (weightDiff !== 0) return weightDiff;
    return (ORIGIN_WEIGHT[b.origem] ?? 0) - (ORIGIN_WEIGHT[a.origem] ?? 0);
  });

  const winner = sorted[0];
  const displaced = sorted.slice(1);

  // Proteção: celebração local não pode deslocar solenidade universal
  const universalSolenity = celebrations.find(
    (c) => c.grau === 'solenidade' && c.origem === 'romano'
  );
  if (universalSolenity && winner.id !== universalSolenity.id) {
    // Garante que a solenidade romana sempre vence
    return {
      celebration: universalSolenity,
      displaced: celebrations.filter((c) => c !== universalSolenity),
      allCelebrations: celebrations,
      origin: 'romano',
      priority: RANK_WEIGHT['solenidade'],
    };
  }

  return {
    celebration: winner,
    displaced,
    allCelebrations: celebrations,
    origin: winner.origem,
    priority: RANK_WEIGHT[winner.grau] ?? 0,
  };
}
