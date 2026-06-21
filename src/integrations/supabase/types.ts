export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_mfa_codes: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          mfa_session_token: string | null
          session_expires_at: string | null
          user_id: string
          verified: boolean
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          mfa_session_token?: string | null
          session_expires_at?: string | null
          user_id: string
          verified?: boolean
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          mfa_session_token?: string | null
          session_expires_at?: string | null
          user_id?: string
          verified?: boolean
        }
        Relationships: []
      }
      atuacoes_pastorais: {
        Row: {
          ativo: boolean
          cor: string
          created_at: string
          descricao: string | null
          icone: string | null
          id: string
          nome: string
          ordem: number
          paroquia_id: string
        }
        Insert: {
          ativo?: boolean
          cor?: string
          created_at?: string
          descricao?: string | null
          icone?: string | null
          id?: string
          nome: string
          ordem?: number
          paroquia_id: string
        }
        Update: {
          ativo?: boolean
          cor?: string
          created_at?: string
          descricao?: string | null
          icone?: string | null
          id?: string
          nome?: string
          ordem?: number
          paroquia_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "atuacoes_pastorais_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          acao: string
          actor_nome: string | null
          actor_user_id: string | null
          created_at: string
          dados_anteriores: Json | null
          dados_novos: Json | null
          entidade: string
          entidade_id: string | null
          id: string
          ip: unknown
          paroquia_id: string | null
          user_agent: string | null
        }
        Insert: {
          acao: string
          actor_nome?: string | null
          actor_user_id?: string | null
          created_at?: string
          dados_anteriores?: Json | null
          dados_novos?: Json | null
          entidade: string
          entidade_id?: string | null
          id?: string
          ip?: unknown
          paroquia_id?: string | null
          user_agent?: string | null
        }
        Update: {
          acao?: string
          actor_nome?: string | null
          actor_user_id?: string | null
          created_at?: string
          dados_anteriores?: Json | null
          dados_novos?: Json | null
          entidade?: string
          entidade_id?: string | null
          id?: string
          ip?: unknown
          paroquia_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      calendario_overrides: {
        Row: {
          cor: string | null
          created_at: string
          created_by: string | null
          data: string
          diocese_id: string | null
          grau: string | null
          id: string
          observacoes: string | null
          paroquia_id: string | null
          tipo_override: string
          titulo: string
        }
        Insert: {
          cor?: string | null
          created_at?: string
          created_by?: string | null
          data: string
          diocese_id?: string | null
          grau?: string | null
          id?: string
          observacoes?: string | null
          paroquia_id?: string | null
          tipo_override?: string
          titulo: string
        }
        Update: {
          cor?: string | null
          created_at?: string
          created_by?: string | null
          data?: string
          diocese_id?: string | null
          grau?: string | null
          id?: string
          observacoes?: string | null
          paroquia_id?: string | null
          tipo_override?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendario_overrides_diocese_id_fkey"
            columns: ["diocese_id"]
            isOneToOne: false
            referencedRelation: "dioceses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendario_overrides_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      comunidades: {
        Row: {
          ativo: boolean
          atualizado_em: string
          criado_em: string
          endereco: string | null
          id: string
          nome: string
          paroquia_id: string
          responsavel: string | null
          tipo: string
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          endereco?: string | null
          id?: string
          nome: string
          paroquia_id: string
          responsavel?: string | null
          tipo?: string
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          endereco?: string | null
          id?: string
          nome?: string
          paroquia_id?: string
          responsavel?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "comunidades_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      coordenadores: {
        Row: {
          ativo: boolean
          atua_como: string | null
          atualizado_em: string
          comunidade: string | null
          criado_em: string
          email: string | null
          funcao_pastoral: string | null
          id: string
          membro_id: string | null
          nome: string
          observacoes: string | null
          paroquia_id: string
          telefone: string | null
        }
        Insert: {
          ativo?: boolean
          atua_como?: string | null
          atualizado_em?: string
          comunidade?: string | null
          criado_em?: string
          email?: string | null
          funcao_pastoral?: string | null
          id?: string
          membro_id?: string | null
          nome: string
          observacoes?: string | null
          paroquia_id: string
          telefone?: string | null
        }
        Update: {
          ativo?: boolean
          atua_como?: string | null
          atualizado_em?: string
          comunidade?: string | null
          criado_em?: string
          email?: string | null
          funcao_pastoral?: string | null
          id?: string
          membro_id?: string | null
          nome?: string
          observacoes?: string | null
          paroquia_id?: string
          telefone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coordenadores_membro_id_fkey"
            columns: ["membro_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coordenadores_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      dioceses: {
        Row: {
          ativo: boolean
          bispo: string | null
          created_at: string
          id: string
          nome: string
          pais: string
          regiao: string | null
          sigla: string | null
          site_url: string | null
        }
        Insert: {
          ativo?: boolean
          bispo?: string | null
          created_at?: string
          id?: string
          nome: string
          pais?: string
          regiao?: string | null
          sigla?: string | null
          site_url?: string | null
        }
        Update: {
          ativo?: boolean
          bispo?: string | null
          created_at?: string
          id?: string
          nome?: string
          pais?: string
          regiao?: string | null
          sigla?: string | null
          site_url?: string | null
        }
        Relationships: []
      }
      email_logs: {
        Row: {
          assunto: string | null
          created_at: string
          destinatario: string
          erro: string | null
          id: string
          paroquia: string | null
          provider: string | null
          provider_id: string | null
          requester_user_id: string | null
          status: string
          tipo: string
        }
        Insert: {
          assunto?: string | null
          created_at?: string
          destinatario: string
          erro?: string | null
          id?: string
          paroquia?: string | null
          provider?: string | null
          provider_id?: string | null
          requester_user_id?: string | null
          status: string
          tipo: string
        }
        Update: {
          assunto?: string | null
          created_at?: string
          destinatario?: string
          erro?: string | null
          id?: string
          paroquia?: string | null
          provider?: string | null
          provider_id?: string | null
          requester_user_id?: string | null
          status?: string
          tipo?: string
        }
        Relationships: []
      }
      escala_funcoes: {
        Row: {
          escala_id: string
          id: string
          ministerio_id: string
          quantidade: number
        }
        Insert: {
          escala_id: string
          id?: string
          ministerio_id: string
          quantidade?: number
        }
        Update: {
          escala_id?: string
          id?: string
          ministerio_id?: string
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "escala_funcoes_escala_id_fkey"
            columns: ["escala_id"]
            isOneToOne: false
            referencedRelation: "escalas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escala_funcoes_ministerio_id_fkey"
            columns: ["ministerio_id"]
            isOneToOne: false
            referencedRelation: "ministerios"
            referencedColumns: ["id"]
          },
        ]
      }
      escala_membros: {
        Row: {
          created_at: string
          escala_id: string
          id: string
          justificativa: string | null
          justificativa_motor: Json | null
          membro_id: string
          ministerio_id: string
          origem: string | null
          score_motor: number | null
          status: string
          substituido_de: string | null
        }
        Insert: {
          created_at?: string
          escala_id: string
          id?: string
          justificativa?: string | null
          justificativa_motor?: Json | null
          membro_id: string
          ministerio_id: string
          origem?: string | null
          score_motor?: number | null
          status?: string
          substituido_de?: string | null
        }
        Update: {
          created_at?: string
          escala_id?: string
          id?: string
          justificativa?: string | null
          justificativa_motor?: Json | null
          membro_id?: string
          ministerio_id?: string
          origem?: string | null
          score_motor?: number | null
          status?: string
          substituido_de?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "escala_membros_escala_id_fkey"
            columns: ["escala_id"]
            isOneToOne: false
            referencedRelation: "escalas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escala_membros_membro_id_fkey"
            columns: ["membro_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escala_membros_ministerio_id_fkey"
            columns: ["ministerio_id"]
            isOneToOne: false
            referencedRelation: "ministerios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escala_membros_substituido_de_fkey"
            columns: ["substituido_de"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
        ]
      }
      escala_ocorrencias: {
        Row: {
          created_at: string
          descricao: string
          escala_id: string
          id: string
          membro_id: string | null
          registrado_por: string
          tipo: string
        }
        Insert: {
          created_at?: string
          descricao: string
          escala_id: string
          id?: string
          membro_id?: string | null
          registrado_por: string
          tipo: string
        }
        Update: {
          created_at?: string
          descricao?: string
          escala_id?: string
          id?: string
          membro_id?: string | null
          registrado_por?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "escala_ocorrencias_escala_id_fkey"
            columns: ["escala_id"]
            isOneToOne: false
            referencedRelation: "escalas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escala_ocorrencias_membro_id_fkey"
            columns: ["membro_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escala_ocorrencias_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
        ]
      }
      escalas: {
        Row: {
          created_at: string
          created_by: string | null
          data: string
          hora_fim: string | null
          hora_inicio: string | null
          id: string
          lembrete_presenca_1d_em: string | null
          lembrete_presenca_2d_em: string | null
          local: string | null
          motor_gerado_em: string | null
          observacoes: string | null
          paramentacao_obrigatoria: boolean
          paroquia_id: string
          publicada_at: string | null
          published_at: string | null
          published_by: string | null
          solene: boolean
          status: string
          tem_adoracao: boolean
          tem_bispo: boolean
          tipo: string
          tipo_missa_id: string | null
          titulo: string
          token_publico: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data: string
          hora_fim?: string | null
          hora_inicio?: string | null
          id?: string
          lembrete_presenca_1d_em?: string | null
          lembrete_presenca_2d_em?: string | null
          local?: string | null
          motor_gerado_em?: string | null
          observacoes?: string | null
          paramentacao_obrigatoria?: boolean
          paroquia_id: string
          publicada_at?: string | null
          published_at?: string | null
          published_by?: string | null
          solene?: boolean
          status?: string
          tem_adoracao?: boolean
          tem_bispo?: boolean
          tipo?: string
          tipo_missa_id?: string | null
          titulo: string
          token_publico?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: string
          hora_fim?: string | null
          hora_inicio?: string | null
          id?: string
          lembrete_presenca_1d_em?: string | null
          lembrete_presenca_2d_em?: string | null
          local?: string | null
          motor_gerado_em?: string | null
          observacoes?: string | null
          paramentacao_obrigatoria?: boolean
          paroquia_id?: string
          publicada_at?: string | null
          published_at?: string | null
          published_by?: string | null
          solene?: boolean
          status?: string
          tem_adoracao?: boolean
          tem_bispo?: boolean
          tipo?: string
          tipo_missa_id?: string | null
          titulo?: string
          token_publico?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "escalas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalas_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalas_tipo_missa_id_fkey"
            columns: ["tipo_missa_id"]
            isOneToOne: false
            referencedRelation: "tipos_missa"
            referencedColumns: ["id"]
          },
        ]
      }
      formacoes_eventos: {
        Row: {
          ativo: boolean
          comunidade: string | null
          created_at: string
          criado_por: string | null
          data_fim: string | null
          data_inicio: string
          descricao: string | null
          id: string
          local: string | null
          obrigatorio: boolean
          observacoes: string | null
          paroquia_id: string
          pontuacao: number
          publico_alvo: string | null
          responsaveis_nomes: string | null
          tipo: string
          titulo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          comunidade?: string | null
          created_at?: string
          criado_por?: string | null
          data_fim?: string | null
          data_inicio: string
          descricao?: string | null
          id?: string
          local?: string | null
          obrigatorio?: boolean
          observacoes?: string | null
          paroquia_id: string
          pontuacao?: number
          publico_alvo?: string | null
          responsaveis_nomes?: string | null
          tipo?: string
          titulo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          comunidade?: string | null
          created_at?: string
          criado_por?: string | null
          data_fim?: string | null
          data_inicio?: string
          descricao?: string | null
          id?: string
          local?: string | null
          obrigatorio?: boolean
          observacoes?: string | null
          paroquia_id?: string
          pontuacao?: number
          publico_alvo?: string | null
          responsaveis_nomes?: string | null
          tipo?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "formacoes_eventos_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      formacoes_materiais: {
        Row: {
          conteudo: string | null
          created_at: string | null
          data_reuniao: string | null
          descricao: string | null
          id: string
          itens: Json | null
          ordem: number
          paroquia_id: string
          publicado: boolean
          tipo: string
          titulo: string
          updated_at: string | null
          url: string | null
        }
        Insert: {
          conteudo?: string | null
          created_at?: string | null
          data_reuniao?: string | null
          descricao?: string | null
          id?: string
          itens?: Json | null
          ordem?: number
          paroquia_id: string
          publicado?: boolean
          tipo?: string
          titulo: string
          updated_at?: string | null
          url?: string | null
        }
        Update: {
          conteudo?: string | null
          created_at?: string | null
          data_reuniao?: string | null
          descricao?: string | null
          id?: string
          itens?: Json | null
          ordem?: number
          paroquia_id?: string
          publicado?: boolean
          tipo?: string
          titulo?: string
          updated_at?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "formacoes_materiais_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      historico_participacoes: {
        Row: {
          created_at: string
          data: string
          descricao: string | null
          escala_id: string | null
          id: string
          membro_id: string
          ministerio_id: string | null
          origem: string | null
          paroquia_id: string
          pontos: number
          presenca: string
          referencia_id: string | null
          tipo_evento: string
        }
        Insert: {
          created_at?: string
          data: string
          descricao?: string | null
          escala_id?: string | null
          id?: string
          membro_id: string
          ministerio_id?: string | null
          origem?: string | null
          paroquia_id: string
          pontos?: number
          presenca?: string
          referencia_id?: string | null
          tipo_evento?: string
        }
        Update: {
          created_at?: string
          data?: string
          descricao?: string | null
          escala_id?: string | null
          id?: string
          membro_id?: string
          ministerio_id?: string | null
          origem?: string | null
          paroquia_id?: string
          pontos?: number
          presenca?: string
          referencia_id?: string | null
          tipo_evento?: string
        }
        Relationships: [
          {
            foreignKeyName: "historico_participacoes_escala_id_fkey"
            columns: ["escala_id"]
            isOneToOne: false
            referencedRelation: "escalas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_participacoes_membro_id_fkey"
            columns: ["membro_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_participacoes_ministerio_id_fkey"
            columns: ["ministerio_id"]
            isOneToOne: false
            referencedRelation: "ministerios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_participacoes_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      historico_substituicoes: {
        Row: {
          acao: string
          actor_id: string | null
          created_at: string
          detalhes: Json
          id: string
          substituicao_id: string
        }
        Insert: {
          acao: string
          actor_id?: string | null
          created_at?: string
          detalhes?: Json
          id?: string
          substituicao_id: string
        }
        Update: {
          acao?: string
          actor_id?: string | null
          created_at?: string
          detalhes?: Json
          id?: string
          substituicao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "historico_substituicoes_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_substituicoes_substituicao_id_fkey"
            columns: ["substituicao_id"]
            isOneToOne: false
            referencedRelation: "substituicoes"
            referencedColumns: ["id"]
          },
        ]
      }
      homilia_sync_logs: {
        Row: {
          created_at: string | null
          data_alvo: string
          detalhes: Json | null
          erro: string | null
          id: string
          strategy: string | null
          sucesso: boolean
        }
        Insert: {
          created_at?: string | null
          data_alvo: string
          detalhes?: Json | null
          erro?: string | null
          id?: string
          strategy?: string | null
          sucesso: boolean
        }
        Update: {
          created_at?: string | null
          data_alvo?: string
          detalhes?: Json | null
          erro?: string | null
          id?: string
          strategy?: string | null
          sucesso?: boolean
        }
        Relationships: []
      }
      homilias_diarias: {
        Row: {
          autor: string | null
          created_at: string
          data: string
          descricao: string | null
          id: string
          thumbnail_url: string | null
          titulo: string
          updated_at: string
          video_id: string
          youtube_url: string
        }
        Insert: {
          autor?: string | null
          created_at?: string
          data: string
          descricao?: string | null
          id?: string
          thumbnail_url?: string | null
          titulo: string
          updated_at?: string
          video_id: string
          youtube_url: string
        }
        Update: {
          autor?: string | null
          created_at?: string
          data?: string
          descricao?: string | null
          id?: string
          thumbnail_url?: string | null
          titulo?: string
          updated_at?: string
          video_id?: string
          youtube_url?: string
        }
        Relationships: []
      }
      indisponibilidades: {
        Row: {
          cancelada: boolean
          created_at: string
          data: string
          data_fim: string | null
          hora_fim: string | null
          hora_inicio: string | null
          id: string
          membro_id: string
          motivo: string | null
          paroquia_id: string
          tipo: string
        }
        Insert: {
          cancelada?: boolean
          created_at?: string
          data: string
          data_fim?: string | null
          hora_fim?: string | null
          hora_inicio?: string | null
          id?: string
          membro_id: string
          motivo?: string | null
          paroquia_id: string
          tipo?: string
        }
        Update: {
          cancelada?: boolean
          created_at?: string
          data?: string
          data_fim?: string | null
          hora_fim?: string | null
          hora_inicio?: string | null
          id?: string
          membro_id?: string
          motivo?: string | null
          paroquia_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "indisponibilidades_membro_id_fkey"
            columns: ["membro_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indisponibilidades_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      liturgia_base: {
        Row: {
          ano: number
          cor: string | null
          created_at: string | null
          data: string
          e_dia_preceito: boolean | null
          e_memorial: boolean | null
          e_solene: boolean | null
          evangelho: string | null
          evangelho_referencia: string | null
          evangelho_texto: string | null
          grau: string | null
          id: string
          leitura_1: string | null
          leitura_1_referencia: string | null
          leitura_1_texto: string | null
          leitura_2: string | null
          leitura_2_referencia: string | null
          leitura_2_texto: string | null
          observacoes: string | null
          origem: string | null
          prefacio: string | null
          salmo: string | null
          salmo_referencia: string | null
          salmo_texto: string | null
          santo: string | null
          subtitulo: string | null
          tempo_liturgico: string | null
          tipo: string | null
          titulo: string
        }
        Insert: {
          ano: number
          cor?: string | null
          created_at?: string | null
          data: string
          e_dia_preceito?: boolean | null
          e_memorial?: boolean | null
          e_solene?: boolean | null
          evangelho?: string | null
          evangelho_referencia?: string | null
          evangelho_texto?: string | null
          grau?: string | null
          id?: string
          leitura_1?: string | null
          leitura_1_referencia?: string | null
          leitura_1_texto?: string | null
          leitura_2?: string | null
          leitura_2_referencia?: string | null
          leitura_2_texto?: string | null
          observacoes?: string | null
          origem?: string | null
          prefacio?: string | null
          salmo?: string | null
          salmo_referencia?: string | null
          salmo_texto?: string | null
          santo?: string | null
          subtitulo?: string | null
          tempo_liturgico?: string | null
          tipo?: string | null
          titulo: string
        }
        Update: {
          ano?: number
          cor?: string | null
          created_at?: string | null
          data?: string
          e_dia_preceito?: boolean | null
          e_memorial?: boolean | null
          e_solene?: boolean | null
          evangelho?: string | null
          evangelho_referencia?: string | null
          evangelho_texto?: string | null
          grau?: string | null
          id?: string
          leitura_1?: string | null
          leitura_1_referencia?: string | null
          leitura_1_texto?: string | null
          leitura_2?: string | null
          leitura_2_referencia?: string | null
          leitura_2_texto?: string | null
          observacoes?: string | null
          origem?: string | null
          prefacio?: string | null
          salmo?: string | null
          salmo_referencia?: string | null
          salmo_texto?: string | null
          santo?: string | null
          subtitulo?: string | null
          tempo_liturgico?: string | null
          tipo?: string | null
          titulo?: string
        }
        Relationships: []
      }
      liturgia_diocese: {
        Row: {
          cor: string | null
          created_at: string | null
          data: string
          diocese_id: string | null
          grau: string | null
          id: string
          observacoes: string | null
          titulo: string
        }
        Insert: {
          cor?: string | null
          created_at?: string | null
          data: string
          diocese_id?: string | null
          grau?: string | null
          id?: string
          observacoes?: string | null
          titulo: string
        }
        Update: {
          cor?: string | null
          created_at?: string | null
          data?: string
          diocese_id?: string | null
          grau?: string | null
          id?: string
          observacoes?: string | null
          titulo?: string
        }
        Relationships: []
      }
      liturgia_importacoes: {
        Row: {
          ano: number
          arquivo_nome: string | null
          created_at: string | null
          erros: Json | null
          id: string
          log: Json | null
          origem: string | null
          status: string | null
        }
        Insert: {
          ano: number
          arquivo_nome?: string | null
          created_at?: string | null
          erros?: Json | null
          id?: string
          log?: Json | null
          origem?: string | null
          status?: string | null
        }
        Update: {
          ano?: number
          arquivo_nome?: string | null
          created_at?: string | null
          erros?: Json | null
          id?: string
          log?: Json | null
          origem?: string | null
          status?: string | null
        }
        Relationships: []
      }
      liturgia_leituras: {
        Row: {
          created_at: string | null
          evangelho: string | null
          id: string
          leitura_1: string | null
          leitura_2: string | null
          liturgia_id: string | null
          prefacio: string | null
          salmo: string | null
        }
        Insert: {
          created_at?: string | null
          evangelho?: string | null
          id?: string
          leitura_1?: string | null
          leitura_2?: string | null
          liturgia_id?: string | null
          prefacio?: string | null
          salmo?: string | null
        }
        Update: {
          created_at?: string | null
          evangelho?: string | null
          id?: string
          leitura_1?: string | null
          leitura_2?: string | null
          liturgia_id?: string | null
          prefacio?: string | null
          salmo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "liturgia_leituras_liturgia_id_fkey"
            columns: ["liturgia_id"]
            isOneToOne: false
            referencedRelation: "liturgia_base"
            referencedColumns: ["id"]
          },
        ]
      }
      liturgia_paroquia: {
        Row: {
          cor: string | null
          created_at: string | null
          data: string
          descricao: string | null
          e_padroeiro: boolean | null
          grau: string | null
          id: string
          paroquia_id: string
          titulo: string
        }
        Insert: {
          cor?: string | null
          created_at?: string | null
          data: string
          descricao?: string | null
          e_padroeiro?: boolean | null
          grau?: string | null
          id?: string
          paroquia_id: string
          titulo: string
        }
        Update: {
          cor?: string | null
          created_at?: string | null
          data?: string
          descricao?: string | null
          e_padroeiro?: boolean | null
          grau?: string | null
          id?: string
          paroquia_id?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "liturgia_paroquia_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      membro_atuacoes: {
        Row: {
          atuacao_id: string
          id: string
          membro_id: string
        }
        Insert: {
          atuacao_id: string
          id?: string
          membro_id: string
        }
        Update: {
          atuacao_id?: string
          id?: string
          membro_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membro_atuacoes_atuacao_id_fkey"
            columns: ["atuacao_id"]
            isOneToOne: false
            referencedRelation: "atuacoes_pastorais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membro_atuacoes_membro_id_fkey"
            columns: ["membro_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
        ]
      }
      membro_funcao_restricoes: {
        Row: {
          id: string
          membro_id: string
          ministerio_id: string
          tipo: string
        }
        Insert: {
          id?: string
          membro_id: string
          ministerio_id: string
          tipo?: string
        }
        Update: {
          id?: string
          membro_id?: string
          ministerio_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "membro_funcao_restricoes_membro_id_fkey"
            columns: ["membro_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membro_funcao_restricoes_ministerio_id_fkey"
            columns: ["ministerio_id"]
            isOneToOne: false
            referencedRelation: "ministerios"
            referencedColumns: ["id"]
          },
        ]
      }
      membro_ministerios: {
        Row: {
          created_at: string
          id: string
          membro_id: string
          ministerio_id: string
          nivel: string
          preferencial_solene: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          membro_id: string
          ministerio_id: string
          nivel?: string
          preferencial_solene?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          membro_id?: string
          ministerio_id?: string
          nivel?: string
          preferencial_solene?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "membro_ministerios_membro_id_fkey"
            columns: ["membro_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membro_ministerios_ministerio_id_fkey"
            columns: ["ministerio_id"]
            isOneToOne: false
            referencedRelation: "ministerios"
            referencedColumns: ["id"]
          },
        ]
      }
      membro_missa_restricoes: {
        Row: {
          created_at: string | null
          membro_id: string
          missa_padrao_id: string
        }
        Insert: {
          created_at?: string | null
          membro_id: string
          missa_padrao_id: string
        }
        Update: {
          created_at?: string | null
          membro_id?: string
          missa_padrao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membro_missa_restricoes_membro_id_fkey"
            columns: ["membro_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membro_missa_restricoes_missa_padrao_id_fkey"
            columns: ["missa_padrao_id"]
            isOneToOne: false
            referencedRelation: "missas_padrao"
            referencedColumns: ["id"]
          },
        ]
      }
      membros: {
        Row: {
          ativacao_enviada_em: string | null
          ativo: boolean
          auth_user_id: string | null
          cep: string | null
          cidade: string | null
          comunidade_id: string | null
          conta_ativada: boolean
          contato_pais: string | null
          cpf: string | null
          cpf_enc: string | null
          cpf_hash: string | null
          created_at: string
          data_ingresso: string | null
          data_nascimento: string | null
          deslocamento: string | null
          email: string | null
          endereco: string | null
          forcar_escalacao_solene: boolean
          foto_url: string | null
          id: string
          missas_nao_pode_ids: string[]
          motivo_disponibilidade: string | null
          nome: string
          nome_emergencia: string | null
          nome_mae: string | null
          nome_pai: string | null
          nome_pais: string | null
          observacoes: string | null
          paroquia_id: string
          perfil_completo: boolean
          planilha_url: string | null
          prioridade_escala: string
          prioridade_id: string | null
          profile_id: string | null
          restricoes_dia_semana: number[]
          restricoes_horario: string | null
          rg: string | null
          score: number
          sexo: string | null
          telefone: string | null
          telefone_emergencia: string | null
          tipo_acesso: string
          token_acesso: string | null
          token_acesso_expires_at: string | null
          updated_at: string
        }
        Insert: {
          ativacao_enviada_em?: string | null
          ativo?: boolean
          auth_user_id?: string | null
          cep?: string | null
          cidade?: string | null
          comunidade_id?: string | null
          conta_ativada?: boolean
          contato_pais?: string | null
          cpf?: string | null
          cpf_enc?: string | null
          cpf_hash?: string | null
          created_at?: string
          data_ingresso?: string | null
          data_nascimento?: string | null
          deslocamento?: string | null
          email?: string | null
          endereco?: string | null
          forcar_escalacao_solene?: boolean
          foto_url?: string | null
          id?: string
          missas_nao_pode_ids?: string[]
          motivo_disponibilidade?: string | null
          nome: string
          nome_emergencia?: string | null
          nome_mae?: string | null
          nome_pai?: string | null
          nome_pais?: string | null
          observacoes?: string | null
          paroquia_id: string
          perfil_completo?: boolean
          planilha_url?: string | null
          prioridade_escala?: string
          prioridade_id?: string | null
          profile_id?: string | null
          restricoes_dia_semana?: number[]
          restricoes_horario?: string | null
          rg?: string | null
          score?: number
          sexo?: string | null
          telefone?: string | null
          telefone_emergencia?: string | null
          tipo_acesso?: string
          token_acesso?: string | null
          token_acesso_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          ativacao_enviada_em?: string | null
          ativo?: boolean
          auth_user_id?: string | null
          cep?: string | null
          cidade?: string | null
          comunidade_id?: string | null
          conta_ativada?: boolean
          contato_pais?: string | null
          cpf?: string | null
          cpf_enc?: string | null
          cpf_hash?: string | null
          created_at?: string
          data_ingresso?: string | null
          data_nascimento?: string | null
          deslocamento?: string | null
          email?: string | null
          endereco?: string | null
          forcar_escalacao_solene?: boolean
          foto_url?: string | null
          id?: string
          missas_nao_pode_ids?: string[]
          motivo_disponibilidade?: string | null
          nome?: string
          nome_emergencia?: string | null
          nome_mae?: string | null
          nome_pai?: string | null
          nome_pais?: string | null
          observacoes?: string | null
          paroquia_id?: string
          perfil_completo?: boolean
          planilha_url?: string | null
          prioridade_escala?: string
          prioridade_id?: string | null
          profile_id?: string | null
          restricoes_dia_semana?: number[]
          restricoes_horario?: string | null
          rg?: string | null
          score?: number
          sexo?: string | null
          telefone?: string | null
          telefone_emergencia?: string | null
          tipo_acesso?: string
          token_acesso?: string | null
          token_acesso_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "membros_comunidade_id_fkey"
            columns: ["comunidade_id"]
            isOneToOne: false
            referencedRelation: "comunidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membros_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membros_prioridade_id_fkey"
            columns: ["prioridade_id"]
            isOneToOne: false
            referencedRelation: "tipos_prioridade"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membros_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_attempts: {
        Row: {
          attempted_at: string
          factor_type: string
          id: string
          ip_address: unknown
          success: boolean
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          attempted_at?: string
          factor_type?: string
          id?: string
          ip_address?: unknown
          success: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          attempted_at?: string
          factor_type?: string
          id?: string
          ip_address?: unknown
          success?: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      ministerios: {
        Row: {
          ativo: boolean
          auto_adicionar: boolean
          categoria: string | null
          cor: string
          created_at: string
          descricao: string | null
          duplicidade_permitida: boolean
          exclusiva_bispo: boolean
          exclusiva_solene: boolean
          exigir_experiencia: boolean
          icone: string | null
          id: string
          mostrar_no_portal: boolean
          nome: string
          ordem: number
          ordem_prioridade: number
          paroquia_id: string
          pontuacao_minima: number
          quantidade_padrao: number
          relevancia: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          auto_adicionar?: boolean
          categoria?: string | null
          cor?: string
          created_at?: string
          descricao?: string | null
          duplicidade_permitida?: boolean
          exclusiva_bispo?: boolean
          exclusiva_solene?: boolean
          exigir_experiencia?: boolean
          icone?: string | null
          id?: string
          mostrar_no_portal?: boolean
          nome: string
          ordem?: number
          ordem_prioridade?: number
          paroquia_id: string
          pontuacao_minima?: number
          quantidade_padrao?: number
          relevancia?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          auto_adicionar?: boolean
          categoria?: string | null
          cor?: string
          created_at?: string
          descricao?: string | null
          duplicidade_permitida?: boolean
          exclusiva_bispo?: boolean
          exclusiva_solene?: boolean
          exigir_experiencia?: boolean
          icone?: string | null
          id?: string
          mostrar_no_portal?: boolean
          nome?: string
          ordem?: number
          ordem_prioridade?: number
          paroquia_id?: string
          pontuacao_minima?: number
          quantidade_padrao?: number
          relevancia?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ministerios_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      missa_padrao_funcoes: {
        Row: {
          id: string
          ministerio_id: string
          missa_padrao_id: string
          quantidade: number
        }
        Insert: {
          id?: string
          ministerio_id: string
          missa_padrao_id: string
          quantidade?: number
        }
        Update: {
          id?: string
          ministerio_id?: string
          missa_padrao_id?: string
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "missa_padrao_funcoes_ministerio_id_fkey"
            columns: ["ministerio_id"]
            isOneToOne: false
            referencedRelation: "ministerios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missa_padrao_funcoes_missa_padrao_id_fkey"
            columns: ["missa_padrao_id"]
            isOneToOne: false
            referencedRelation: "missas_padrao"
            referencedColumns: ["id"]
          },
        ]
      }
      missas_padrao: {
        Row: {
          ativo: boolean
          created_at: string
          dia_semana: number
          hora_fim: string | null
          hora_inicio: string | null
          id: string
          local: string | null
          nome: string
          observacoes: string | null
          ordem: number
          paroquia_id: string
          recorrencia: Json
          solene: boolean
          tem_adoracao: boolean
          tem_bispo: boolean
          tipo: string
          tipo_missa_id: string | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          dia_semana: number
          hora_fim?: string | null
          hora_inicio?: string | null
          id?: string
          local?: string | null
          nome: string
          observacoes?: string | null
          ordem?: number
          paroquia_id: string
          recorrencia?: Json
          solene?: boolean
          tem_adoracao?: boolean
          tem_bispo?: boolean
          tipo?: string
          tipo_missa_id?: string | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          dia_semana?: number
          hora_fim?: string | null
          hora_inicio?: string | null
          id?: string
          local?: string | null
          nome?: string
          observacoes?: string | null
          ordem?: number
          paroquia_id?: string
          recorrencia?: Json
          solene?: boolean
          tem_adoracao?: boolean
          tem_bispo?: boolean
          tipo?: string
          tipo_missa_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "missas_padrao_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missas_padrao_tipo_missa_id_fkey"
            columns: ["tipo_missa_id"]
            isOneToOne: false
            referencedRelation: "tipos_missa"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacao_tokens: {
        Row: {
          created_at: string
          expires_at: string
          substituicao_id: string
          token: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          substituicao_id: string
          token?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          substituicao_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificacao_tokens_substituicao_id_fkey"
            columns: ["substituicao_id"]
            isOneToOne: false
            referencedRelation: "substituicoes"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes: {
        Row: {
          apenas_admin: boolean
          apenas_coordenacao: boolean
          created_at: string
          criada_por: string | null
          destinatario_id: string | null
          id: string
          lida: boolean
          link_referencia: string | null
          mensagem: string | null
          paroquia_id: string
          tipo: string
          titulo: string
        }
        Insert: {
          apenas_admin?: boolean
          apenas_coordenacao?: boolean
          created_at?: string
          criada_por?: string | null
          destinatario_id?: string | null
          id?: string
          lida?: boolean
          link_referencia?: string | null
          mensagem?: string | null
          paroquia_id: string
          tipo?: string
          titulo: string
        }
        Update: {
          apenas_admin?: boolean
          apenas_coordenacao?: boolean
          created_at?: string
          criada_por?: string | null
          destinatario_id?: string | null
          id?: string
          lida?: boolean
          link_referencia?: string | null
          mensagem?: string | null
          paroquia_id?: string
          tipo?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_destinatario_id_fkey"
            columns: ["destinatario_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      notificacoes_leituras: {
        Row: {
          id: string
          lida_em: string
          membro_id: string
          notificacao_id: string
        }
        Insert: {
          id?: string
          lida_em?: string
          membro_id: string
          notificacao_id: string
        }
        Update: {
          id?: string
          lida_em?: string
          membro_id?: string
          notificacao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificacoes_leituras_membro_id_fkey"
            columns: ["membro_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificacoes_leituras_notificacao_id_fkey"
            columns: ["notificacao_id"]
            isOneToOne: false
            referencedRelation: "notificacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      ocorrencias_escala: {
        Row: {
          created_at: string
          criado_por: string | null
          data: string
          descricao: string | null
          escala_id: string | null
          gravidade: string
          id: string
          membro_id: string
          paroquia_id: string
          tipo: string
        }
        Insert: {
          created_at?: string
          criado_por?: string | null
          data?: string
          descricao?: string | null
          escala_id?: string | null
          gravidade?: string
          id?: string
          membro_id: string
          paroquia_id: string
          tipo?: string
        }
        Update: {
          created_at?: string
          criado_por?: string | null
          data?: string
          descricao?: string | null
          escala_id?: string | null
          gravidade?: string
          id?: string
          membro_id?: string
          paroquia_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "ocorrencias_escala_escala_id_fkey"
            columns: ["escala_id"]
            isOneToOne: false
            referencedRelation: "escalas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_escala_membro_id_fkey"
            columns: ["membro_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_escala_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      ocorrencias_membros: {
        Row: {
          created_at: string
          descricao: string
          id: string
          membro_id: string
          paroquia_id: string
          respondido_por: string | null
          resposta: string | null
          status: string
          tipo: string
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          descricao: string
          id?: string
          membro_id: string
          paroquia_id: string
          respondido_por?: string | null
          resposta?: string | null
          status?: string
          tipo: string
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          descricao?: string
          id?: string
          membro_id?: string
          paroquia_id?: string
          respondido_por?: string | null
          resposta?: string | null
          status?: string
          tipo?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ocorrencias_membros_membro_id_fkey"
            columns: ["membro_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_membros_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_membros_respondido_por_fkey"
            columns: ["respondido_por"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
        ]
      }
      paroquia_config_escalas: {
        Row: {
          auto_pontuar: boolean
          confirmacao_ativa: boolean
          confirmacao_horas_antes: number
          horas_limite_confirmacao: number | null
          paroquia_id: string
          pontuacao_adoracao: number
          pontuacao_atraso: number
          pontuacao_compromisso: number
          pontuacao_encontro: number
          pontuacao_ensaio: number
          pontuacao_evento: number
          pontuacao_falta: number
          pontuacao_formacao: number
          pontuacao_justificou: number
          pontuacao_ocorrencia_grave: number
          pontuacao_presenca: number
          pontuacao_presenca_bispo: number
          pontuacao_presenca_solene: number
          pontuacao_retiro: number
          pontuacao_reuniao: number
          pontuacao_substituicao_aceita: number
          pontuacao_substituicao_recusada: number
          substituicao_ativa: boolean
          substituicao_horas_antes: number
          updated_at: string
        }
        Insert: {
          auto_pontuar?: boolean
          confirmacao_ativa?: boolean
          confirmacao_horas_antes?: number
          horas_limite_confirmacao?: number | null
          paroquia_id: string
          pontuacao_adoracao?: number
          pontuacao_atraso?: number
          pontuacao_compromisso?: number
          pontuacao_encontro?: number
          pontuacao_ensaio?: number
          pontuacao_evento?: number
          pontuacao_falta?: number
          pontuacao_formacao?: number
          pontuacao_justificou?: number
          pontuacao_ocorrencia_grave?: number
          pontuacao_presenca?: number
          pontuacao_presenca_bispo?: number
          pontuacao_presenca_solene?: number
          pontuacao_retiro?: number
          pontuacao_reuniao?: number
          pontuacao_substituicao_aceita?: number
          pontuacao_substituicao_recusada?: number
          substituicao_ativa?: boolean
          substituicao_horas_antes?: number
          updated_at?: string
        }
        Update: {
          auto_pontuar?: boolean
          confirmacao_ativa?: boolean
          confirmacao_horas_antes?: number
          horas_limite_confirmacao?: number | null
          paroquia_id?: string
          pontuacao_adoracao?: number
          pontuacao_atraso?: number
          pontuacao_compromisso?: number
          pontuacao_encontro?: number
          pontuacao_ensaio?: number
          pontuacao_evento?: number
          pontuacao_falta?: number
          pontuacao_formacao?: number
          pontuacao_justificou?: number
          pontuacao_ocorrencia_grave?: number
          pontuacao_presenca?: number
          pontuacao_presenca_bispo?: number
          pontuacao_presenca_solene?: number
          pontuacao_retiro?: number
          pontuacao_reuniao?: number
          pontuacao_substituicao_aceita?: number
          pontuacao_substituicao_recusada?: number
          substituicao_ativa?: boolean
          substituicao_horas_antes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "paroquia_config_escalas_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: true
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      paroquias: {
        Row: {
          allow_magic_link: boolean
          cidade: string | null
          contato_email: string | null
          contato_telefone: string | null
          cor_primaria: string | null
          created_at: string
          created_by: string | null
          diocese: string | null
          diocese_id: string | null
          endereco: string | null
          id: string
          logo_url: string | null
          nome: string
          padroeiro: string | null
          pdf_cabecalho_url: string | null
          pdf_rodape_url: string | null
          pontuacao_config: Json
          regras_escala: Json
          slug: string
          token_portal: string | null
          token_portal_generated_at: string | null
          updated_at: string
          usa_baculifero: boolean
          usa_mitrifero: boolean
          usa_naveta: boolean
          usa_tochas: boolean
          usa_turibulo: boolean
        }
        Insert: {
          allow_magic_link?: boolean
          cidade?: string | null
          contato_email?: string | null
          contato_telefone?: string | null
          cor_primaria?: string | null
          created_at?: string
          created_by?: string | null
          diocese?: string | null
          diocese_id?: string | null
          endereco?: string | null
          id?: string
          logo_url?: string | null
          nome: string
          padroeiro?: string | null
          pdf_cabecalho_url?: string | null
          pdf_rodape_url?: string | null
          pontuacao_config?: Json
          regras_escala?: Json
          slug: string
          token_portal?: string | null
          token_portal_generated_at?: string | null
          updated_at?: string
          usa_baculifero?: boolean
          usa_mitrifero?: boolean
          usa_naveta?: boolean
          usa_tochas?: boolean
          usa_turibulo?: boolean
        }
        Update: {
          allow_magic_link?: boolean
          cidade?: string | null
          contato_email?: string | null
          contato_telefone?: string | null
          cor_primaria?: string | null
          created_at?: string
          created_by?: string | null
          diocese?: string | null
          diocese_id?: string | null
          endereco?: string | null
          id?: string
          logo_url?: string | null
          nome?: string
          padroeiro?: string | null
          pdf_cabecalho_url?: string | null
          pdf_rodape_url?: string | null
          pontuacao_config?: Json
          regras_escala?: Json
          slug?: string
          token_portal?: string | null
          token_portal_generated_at?: string | null
          updated_at?: string
          usa_baculifero?: boolean
          usa_mitrifero?: boolean
          usa_naveta?: boolean
          usa_tochas?: boolean
          usa_turibulo?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "paroquias_diocese_id_fkey"
            columns: ["diocese_id"]
            isOneToOne: false
            referencedRelation: "dioceses"
            referencedColumns: ["id"]
          },
        ]
      }
      presencas_eventos: {
        Row: {
          created_at: string
          evento_id: string
          id: string
          justificativa: string | null
          membro_id: string
          observacoes: string | null
          pontuacao_recebida: number | null
          presente: boolean | null
          registrado_por: string | null
        }
        Insert: {
          created_at?: string
          evento_id: string
          id?: string
          justificativa?: string | null
          membro_id: string
          observacoes?: string | null
          pontuacao_recebida?: number | null
          presente?: boolean | null
          registrado_por?: string | null
        }
        Update: {
          created_at?: string
          evento_id?: string
          id?: string
          justificativa?: string | null
          membro_id?: string
          observacoes?: string | null
          pontuacao_recebida?: number | null
          presente?: boolean | null
          registrado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "presencas_eventos_evento_id_fkey"
            columns: ["evento_id"]
            isOneToOne: false
            referencedRelation: "formacoes_eventos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presencas_eventos_membro_id_fkey"
            columns: ["membro_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          id: string
          nome_completo: string | null
          paroquia_id: string | null
          telefone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id: string
          nome_completo?: string | null
          paroquia_id?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: string
          nome_completo?: string | null
          paroquia_id?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      regioes_liturgicas: {
        Row: {
          created_at: string
          descricao: string | null
          diocese_id: string | null
          id: string
          nome: string
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          diocese_id?: string | null
          id?: string
          nome: string
        }
        Update: {
          created_at?: string
          descricao?: string | null
          diocese_id?: string | null
          id?: string
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "regioes_liturgicas_diocese_id_fkey"
            columns: ["diocese_id"]
            isOneToOne: false
            referencedRelation: "dioceses"
            referencedColumns: ["id"]
          },
        ]
      }
      security_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      solicitacoes_membros: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          created_at: string
          dados_json: Json
          email: string | null
          foto_url: string | null
          id: string
          motivo_rejeicao: string | null
          nome: string
          paroquia_id: string
          status: string
          telefone: string | null
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          created_at?: string
          dados_json?: Json
          email?: string | null
          foto_url?: string | null
          id?: string
          motivo_rejeicao?: string | null
          nome: string
          paroquia_id: string
          status?: string
          telefone?: string | null
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          created_at?: string
          dados_json?: Json
          email?: string | null
          foto_url?: string | null
          id?: string
          motivo_rejeicao?: string | null
          nome?: string
          paroquia_id?: string
          status?: string
          telefone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "solicitacoes_membros_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacoes_membros_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitacoes_paroquia: {
        Row: {
          analisado_em: string | null
          analisado_por: string | null
          cidade: string
          created_at: string
          diocese: string
          email: string
          estado: string
          id: string
          mensagem: string | null
          motivo_rejeicao: string | null
          nome_paroquia: string
          paroquia_id: string | null
          responsavel: string
          status: string
          telefone: string
          updated_at: string
        }
        Insert: {
          analisado_em?: string | null
          analisado_por?: string | null
          cidade: string
          created_at?: string
          diocese: string
          email: string
          estado: string
          id?: string
          mensagem?: string | null
          motivo_rejeicao?: string | null
          nome_paroquia: string
          paroquia_id?: string | null
          responsavel: string
          status?: string
          telefone: string
          updated_at?: string
        }
        Update: {
          analisado_em?: string | null
          analisado_por?: string | null
          cidade?: string
          created_at?: string
          diocese?: string
          email?: string
          estado?: string
          id?: string
          mensagem?: string | null
          motivo_rejeicao?: string | null
          nome_paroquia?: string
          paroquia_id?: string | null
          responsavel?: string
          status?: string
          telefone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitacoes_paroquia_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      substituicoes: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          created_at: string
          escala_id: string | null
          escala_membro_id: string
          id: string
          motivo_rejeicao: string | null
          motivo_solicitacao: string | null
          paroquia_id: string
          solicitante_id: string
          status: string
          substituto_id: string | null
          updated_at: string
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          created_at?: string
          escala_id?: string | null
          escala_membro_id: string
          id?: string
          motivo_rejeicao?: string | null
          motivo_solicitacao?: string | null
          paroquia_id: string
          solicitante_id: string
          status?: string
          substituto_id?: string | null
          updated_at?: string
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          created_at?: string
          escala_id?: string | null
          escala_membro_id?: string
          id?: string
          motivo_rejeicao?: string | null
          motivo_solicitacao?: string | null
          paroquia_id?: string
          solicitante_id?: string
          status?: string
          substituto_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "substituicoes_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "substituicoes_escala_id_fkey"
            columns: ["escala_id"]
            isOneToOne: false
            referencedRelation: "escalas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "substituicoes_escala_membro_id_fkey"
            columns: ["escala_membro_id"]
            isOneToOne: false
            referencedRelation: "escala_membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "substituicoes_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "substituicoes_solicitante_id_fkey"
            columns: ["solicitante_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "substituicoes_substituto_id_fkey"
            columns: ["substituto_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
        ]
      }
      tipo_missa_funcoes: {
        Row: {
          id: string
          ministerio_id: string
          prioridade: number
          quantidade_max: number
          quantidade_min: number
          tipo_missa_id: string
          tipo_vinculo: string
        }
        Insert: {
          id?: string
          ministerio_id: string
          prioridade?: number
          quantidade_max?: number
          quantidade_min?: number
          tipo_missa_id: string
          tipo_vinculo?: string
        }
        Update: {
          id?: string
          ministerio_id?: string
          prioridade?: number
          quantidade_max?: number
          quantidade_min?: number
          tipo_missa_id?: string
          tipo_vinculo?: string
        }
        Relationships: [
          {
            foreignKeyName: "tipo_missa_funcoes_ministerio_id_fkey"
            columns: ["ministerio_id"]
            isOneToOne: false
            referencedRelation: "ministerios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tipo_missa_funcoes_tipo_missa_id_fkey"
            columns: ["tipo_missa_id"]
            isOneToOne: false
            referencedRelation: "tipos_missa"
            referencedColumns: ["id"]
          },
        ]
      }
      tipos_missa: {
        Row: {
          ativo: boolean
          cor: string
          created_at: string
          descricao: string | null
          icone: string | null
          id: string
          nome: string
          ordem: number
          paroquia_id: string
          prioridade_liturgica: number
          usa_baculifero: boolean
          usa_mitrifero: boolean
          usa_naveta: boolean
          usa_turibulo: boolean
        }
        Insert: {
          ativo?: boolean
          cor?: string
          created_at?: string
          descricao?: string | null
          icone?: string | null
          id?: string
          nome: string
          ordem?: number
          paroquia_id: string
          prioridade_liturgica?: number
          usa_baculifero?: boolean
          usa_mitrifero?: boolean
          usa_naveta?: boolean
          usa_turibulo?: boolean
        }
        Update: {
          ativo?: boolean
          cor?: string
          created_at?: string
          descricao?: string | null
          icone?: string | null
          id?: string
          nome?: string
          ordem?: number
          paroquia_id?: string
          prioridade_liturgica?: number
          usa_baculifero?: boolean
          usa_mitrifero?: boolean
          usa_naveta?: boolean
          usa_turibulo?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "tipos_missa_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      tipos_prioridade: {
        Row: {
          ativo: boolean
          cor: string
          created_at: string
          descricao: string | null
          frequencia_max: number | null
          frequencia_min: number | null
          id: string
          nome: string
          ordem: number
          paroquia_id: string
          peso_escala: number
          priorizar_eventos_especiais: boolean
          priorizar_solenes: boolean
        }
        Insert: {
          ativo?: boolean
          cor?: string
          created_at?: string
          descricao?: string | null
          frequencia_max?: number | null
          frequencia_min?: number | null
          id?: string
          nome: string
          ordem?: number
          paroquia_id: string
          peso_escala?: number
          priorizar_eventos_especiais?: boolean
          priorizar_solenes?: boolean
        }
        Update: {
          ativo?: boolean
          cor?: string
          created_at?: string
          descricao?: string | null
          frequencia_max?: number | null
          frequencia_min?: number | null
          id?: string
          nome?: string
          ordem?: number
          paroquia_id?: string
          peso_escala?: number
          priorizar_eventos_especiais?: boolean
          priorizar_solenes?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "tipos_prioridade_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      user_mfa_settings: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          last_verified_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_verified_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_verified_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          paroquia_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          paroquia_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          paroquia_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _get_pontos_status: {
        Args: {
          p_paroquia_id: string
          p_solene?: boolean
          p_status: string
          p_tem_bispo?: boolean
        }
        Returns: number
      }
      _get_pontos_tipo_evento: {
        Args: { p_paroquia_id: string; p_tipo: string }
        Returns: number
      }
      _notify_all_membros:
        | {
            Args: {
              p_mensagem: string
              p_paroquia_id: string
              p_tipo?: string
              p_titulo: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_link?: string
              p_mensagem: string
              p_paroquia_id: string
              p_tipo?: string
              p_titulo: string
            }
            Returns: undefined
          }
      _notify_coordenacao: {
        Args: {
          p_link?: string
          p_mensagem: string
          p_paroquia_id: string
          p_tipo?: string
          p_titulo: string
        }
        Returns: undefined
      }
      _portal_escala_paroquia: {
        Args: { p_escala_id: string }
        Returns: string
      }
      _portal_is_admin: { Args: { p_paroquia_id: string }; Returns: boolean }
      _portal_is_coord: { Args: { p_membro_id: string }; Returns: boolean }
      _portal_membro_id: { Args: never; Returns: string }
      _portal_membro_paroquia: {
        Args: { p_membro_id: string }
        Returns: string
      }
      admin_buscar_substitutos: {
        Args: { p_escala_id: string; p_ministerio_id: string }
        Returns: {
          membro_id: string
          nome: string
          score: number
          tem_indisp: boolean
        }[]
      }
      admin_get_ativacao_stats: {
        Args: never
        Returns: {
          conta_ativada: number
          convite_enviado: number
          logins_realizados: number
          nunca_convidados: number
          pendentes_ativacao: number
          sem_auth_user: number
          sem_email: number
          sem_login_pos_ativacao: number
          sem_profile: number
          sem_role: number
          total_membros: number
        }[]
      }
      admin_get_ativados_sem_login: {
        Args: never
        Returns: {
          ativado_em: string
          auth_user_id: string
          conta_ativada: boolean
          email: string
          membro_id: string
          nome: string
          token_acesso: string
          token_expirado: boolean
          ultimo_login: string
        }[]
      }
      admin_get_auth_sem_membro: {
        Args: never
        Returns: {
          auth_user_id: string
          criado_em: string
          email: string
          email_confirmado: boolean
          tem_profile: boolean
          tem_role: boolean
          ultimo_login: string
        }[]
      }
      admin_get_email_logs_recentes: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          destinatario: string
          erro: string
          id: string
          provider: string
          status: string
          tipo: string
        }[]
      }
      admin_get_email_logs_stats: {
        Args: never
        Returns: {
          ativacoes_novas: number
          com_erro: number
          entregues: number
          reenvios: number
          resets_senha: number
          total_enviados: number
          ultimo_envio: string
          via_fallback: number
        }[]
      }
      admin_get_membros_inconsistentes: {
        Args: never
        Returns: {
          ativacao_enviada_em: string
          auth_user_id: string
          criado_em: string
          detalhe: string
          email: string
          membro_id: string
          nome: string
          tipo_problema: string
          token_acesso: string
          ultimo_login: string
        }[]
      }
      admin_recalcular_scores_paroquia: {
        Args: { p_paroquia_id: string }
        Returns: Json
      }
      admin_recriar_profile_role: {
        Args: { p_membro_id: string }
        Returns: Json
      }
      admin_reprocessar_historico_escala: {
        Args: { p_paroquia_id: string }
        Returns: Json
      }
      admin_reprocessar_pendentes: {
        Args: never
        Returns: {
          acao: string
          email: string
          membro_id: string
          nome: string
          resultado: string
        }[]
      }
      admin_vincular_auth_membro: {
        Args: { p_membro_id: string }
        Returns: Json
      }
      ativar_conta_membro: { Args: never; Returns: Json }
      atualizar_perfil_membro: {
        Args: {
          p_cep?: string
          p_cidade?: string
          p_cpf?: string
          p_data_nascimento?: string
          p_endereco?: string
          p_nome?: string
          p_nome_emergencia?: string
          p_nome_mae?: string
          p_nome_pai?: string
          p_observacoes?: string
          p_rg?: string
          p_telefone?: string
          p_telefone_emergencia?: string
        }
        Returns: Json
      }
      auth_member_paroquia_id: { Args: never; Returns: string }
      auth_membro_id: { Args: never; Returns: string }
      check_admin_mfa_session: {
        Args: { p_session_token: string }
        Returns: Json
      }
      check_confirmacoes_expiradas: {
        Args: { p_paroquia_id?: string }
        Returns: {
          escala_data: string
          escala_membro_id: string
          escala_titulo: string
          escalado_em: string
          horas_sem_resposta: number
          membro_id: string
          membro_nome: string
          ministerio_nome: string
        }[]
      }
      check_email_rate_limit: {
        Args: {
          p_destinatario: string
          p_requester_id?: string
          p_tipo: string
        }
        Returns: Json
      }
      check_magic_link_allowed: { Args: { p_email: string }; Returns: boolean }
      completar_perfil_membro: {
        Args: {
          p_atuacao_ids?: string[]
          p_comunidade_id?: string
          p_data_nascimento?: string
          p_missa_restricao_ids?: string[]
          p_motivo_disponibilidade?: string
          p_sexo?: string
          p_telefone?: string
        }
        Returns: Json
      }
      coord_aprovar_substituicao: {
        Args: { p_substituicao_id: string }
        Returns: Json
      }
      coord_get_substituicoes: {
        Args: { p_status?: string }
        Returns: {
          aprovado_em: string
          aprovador_nome: string
          created_at: string
          escala_data: string
          escala_id: string
          escala_titulo: string
          id: string
          ministerio_cor: string
          ministerio_id: string
          ministerio_nome: string
          motivo_rejeicao: string
          motivo_solicitacao: string
          solicitante_nome: string
          status: string
          substituto_nome: string
        }[]
      }
      coord_reenviar_notificacao_substituicao: {
        Args: { p_substituicao_id: string }
        Returns: Json
      }
      coord_rejeitar_substituicao: {
        Args: { p_motivo?: string; p_substituicao_id: string }
        Returns: Json
      }
      count_recent_mfa_failures: {
        Args: { p_window_minutes?: number }
        Returns: number
      }
      current_paroquia_id: { Args: never; Returns: string }
      enviar_alerta_confirmacao: {
        Args: { p_escala_membro_id: string }
        Returns: Json
      }
      enviar_lembretes_presenca: { Args: never; Returns: undefined }
      get_ocorrencias_paroquia: {
        Args: { p_paroquia_id: string; p_status?: string }
        Returns: {
          created_at: string
          descricao: string
          id: string
          membro_id: string
          membro_nome: string
          paroquia_id: string
          respondido_por: string
          resposta: string
          status: string
          tipo: string
          titulo: string
          updated_at: string
        }[]
      }
      is_coordenador_da_paroquia: {
        Args: { p_paroquia_id: string }
        Returns: boolean
      }
      log_mfa_attempt: {
        Args: {
          p_factor_type: string
          p_ip_address?: string
          p_success: boolean
          p_user_agent?: string
        }
        Returns: undefined
      }
      marcar_presenca_evento: {
        Args: {
          p_data: string
          p_evento_id: string
          p_membro_id: string
          p_paroquia_id: string
          p_presente: boolean
          p_tipo: string
          p_titulo: string
        }
        Returns: undefined
      }
      membro_paroquia_id: { Args: never; Returns: string }
      portal_add_indisponibilidade: {
        Args: { p_data: string; p_motivo?: string; p_token: string }
        Returns: string
      }
      portal_auto_link_by_email: { Args: never; Returns: Json }
      portal_cancelar_substituicao: {
        Args: { p_substituicao_id: string }
        Returns: Json
      }
      portal_check_member_email: {
        Args: { p_email: string; p_slug: string }
        Returns: Json
      }
      portal_count_notif_nao_lidas: { Args: never; Returns: number }
      portal_get_escalas_membro: { Args: { p_token: string }; Returns: Json }
      portal_get_historico_membro: { Args: { p_token: string }; Returns: Json }
      portal_get_indisponibilidades_membro: {
        Args: { p_token: string }
        Returns: Json
      }
      portal_get_membro: { Args: { p_token: string }; Returns: Json }
      portal_get_membro_por_token: { Args: { p_token: string }; Returns: Json }
      portal_get_notif_urgentes_nao_lidas: {
        Args: never
        Returns: {
          id: string
          mensagem: string
          titulo: string
        }[]
      }
      portal_get_own_membro: { Args: never; Returns: Json }
      portal_get_substituicoes_membro: {
        Args: never
        Returns: {
          created_at: string
          escala_data: string
          escala_titulo: string
          id: string
          ministerio_cor: string
          ministerio_nome: string
          motivo_rejeicao: string
          motivo_solicitacao: string
          solicitante_nome: string
          status: string
          substituto_nome: string
          tipo: string
          updated_at: string
        }[]
      }
      portal_link_auth_user: {
        Args: { p_email: string; p_slug: string }
        Returns: Json
      }
      portal_marcar_notificacao_lida: {
        Args: { p_notif_id: string }
        Returns: Json
      }
      portal_marcar_todas_notificacoes_lidas: { Args: never; Returns: Json }
      portal_recusar_escala: {
        Args: { p_escala_membro_id: string; p_motivo?: string }
        Returns: Json
      }
      portal_remove_indisponibilidade: {
        Args: { p_indisp_id: string; p_token: string }
        Returns: undefined
      }
      portal_responder_escala: {
        Args: {
          p_escala_membro_id: string
          p_justificativa?: string
          p_status: string
          p_token: string
        }
        Returns: undefined
      }
      portal_rotacionar_token: {
        Args: { p_membro_id: string }
        Returns: string
      }
      portal_solicitar_substituicao: {
        Args: { p_escala_membro_id: string; p_motivo?: string }
        Returns: Json
      }
      portal_voluntariar_substituicao: {
        Args: { p_substituicao_id: string }
        Returns: Json
      }
      reenviar_notificacoes_escala: {
        Args: { p_escala_id: string }
        Returns: Json
      }
      rotacionar_token_portal: {
        Args: { p_paroquia_id: string }
        Returns: Json
      }
      salvar_presencas_escala: {
        Args: { p_escala_id: string; p_updates: Json }
        Returns: undefined
      }
      store_admin_mfa_code: {
        Args: { p_code_hash: string; p_user_email: string }
        Returns: undefined
      }
      sync_homilia_diaria: { Args: never; Returns: undefined }
      sync_homilia_se_ausente: { Args: never; Returns: undefined }
      verify_admin_mfa_code: { Args: { p_code: string }; Returns: Json }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "admin_paroquial"
        | "lider"
        | "servidor"
        | "coordenador"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "super_admin",
        "admin_paroquial",
        "lider",
        "servidor",
        "coordenador",
      ],
    },
  },
} as const
