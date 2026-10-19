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
      _push_config: {
        Row: {
          key: string
          val: string
        }
        Insert: {
          key: string
          val: string
        }
        Update: {
          key?: string
          val?: string
        }
        Relationships: []
      }
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
          atuacoes_exigidas: string[] | null
          escala_id: string
          id: string
          ministerio_id: string
          quantidade: number
        }
        Insert: {
          atuacoes_exigidas?: string[] | null
          escala_id: string
          id?: string
          ministerio_id: string
          quantidade?: number
        }
        Update: {
          atuacoes_exigidas?: string[] | null
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
          ativo: boolean
          created_at: string
          escala_id: string
          id: string
          justificativa: string | null
          justificativa_motor: Json | null
          membro_id: string
          ministerio_id: string
          origem: string | null
          presenca_registrada_em: string | null
          presenca_registrada_por: string | null
          removido_em: string | null
          score_motor: number | null
          status: string
          substituido_de: string | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          escala_id: string
          id?: string
          justificativa?: string | null
          justificativa_motor?: Json | null
          membro_id: string
          ministerio_id: string
          origem?: string | null
          presenca_registrada_em?: string | null
          presenca_registrada_por?: string | null
          removido_em?: string | null
          score_motor?: number | null
          status?: string
          substituido_de?: string | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          escala_id?: string
          id?: string
          justificativa?: string | null
          justificativa_motor?: Json | null
          membro_id?: string
          ministerio_id?: string
          origem?: string | null
          presenca_registrada_em?: string | null
          presenca_registrada_por?: string | null
          removido_em?: string | null
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
            foreignKeyName: "escala_membros_presenca_registrada_por_fkey"
            columns: ["presenca_registrada_por"]
            isOneToOne: false
            referencedRelation: "membros"
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
          aderencia_motor: number | null
          arquivada_em: string | null
          arquivada_por: string | null
          created_at: string
          created_by: string | null
          data: string
          hora_fim: string | null
          hora_inicio: string | null
          id: string
          ignorar_indisponibilidades: boolean
          lembrete_presenca_1d_em: string | null
          lembrete_presenca_2d_em: string | null
          local: string | null
          modo_selecao: string
          motivo_cancelamento: string | null
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
          todos_paramentados: boolean
          token_publico: string
          updated_at: string
        }
        Insert: {
          aderencia_motor?: number | null
          arquivada_em?: string | null
          arquivada_por?: string | null
          created_at?: string
          created_by?: string | null
          data: string
          hora_fim?: string | null
          hora_inicio?: string | null
          id?: string
          ignorar_indisponibilidades?: boolean
          lembrete_presenca_1d_em?: string | null
          lembrete_presenca_2d_em?: string | null
          local?: string | null
          modo_selecao?: string
          motivo_cancelamento?: string | null
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
          todos_paramentados?: boolean
          token_publico?: string
          updated_at?: string
        }
        Update: {
          aderencia_motor?: number | null
          arquivada_em?: string | null
          arquivada_por?: string | null
          created_at?: string
          created_by?: string | null
          data?: string
          hora_fim?: string | null
          hora_inicio?: string | null
          id?: string
          ignorar_indisponibilidades?: boolean
          lembrete_presenca_1d_em?: string | null
          lembrete_presenca_2d_em?: string | null
          local?: string | null
          modo_selecao?: string
          motivo_cancelamento?: string | null
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
          todos_paramentados?: boolean
          token_publico?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "escalas_arquivada_por_fkey"
            columns: ["arquivada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
          escala_id: string | null
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
          escala_id?: string | null
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
          escala_id?: string | null
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
            foreignKeyName: "formacoes_eventos_escala_id_fkey"
            columns: ["escala_id"]
            isOneToOne: false
            referencedRelation: "escalas"
            referencedColumns: ["id"]
          },
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
          evento_id: string | null
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
          evento_id?: string | null
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
          evento_id?: string | null
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
            foreignKeyName: "formacoes_materiais_evento_id_fkey"
            columns: ["evento_id"]
            isOneToOne: false
            referencedRelation: "formacoes_eventos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formacoes_materiais_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_credentials: {
        Row: {
          created_at: string
          gateway: string
          id: string
          is_active: boolean
          label: string
          public_key: string | null
          sandbox: boolean
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          created_at?: string
          gateway: string
          id?: string
          is_active?: boolean
          label: string
          public_key?: string | null
          sandbox?: boolean
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          created_at?: string
          gateway?: string
          id?: string
          is_active?: boolean
          label?: string
          public_key?: string | null
          sandbox?: boolean
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: []
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
      impersonate_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          ip_address: unknown
          reason: string
          revoked_at: string | null
          super_admin_id: string
          target_paroquia_id: string
          target_user_id: string
          token: string
          used_at: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          ip_address?: unknown
          reason: string
          revoked_at?: string | null
          super_admin_id: string
          target_paroquia_id: string
          target_user_id: string
          token?: string
          used_at?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          ip_address?: unknown
          reason?: string
          revoked_at?: string | null
          super_admin_id?: string
          target_paroquia_id?: string
          target_user_id?: string
          token?: string
          used_at?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "impersonate_sessions_target_paroquia_id_fkey"
            columns: ["target_paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
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
      invoices: {
        Row: {
          amount_brl: number
          created_at: string
          description: string | null
          due_date: string
          gateway_invoice_id: string | null
          id: string
          metadata: Json
          paid_at: string | null
          paroquia_id: string
          payment_method: string | null
          period_end: string | null
          period_start: string | null
          status: string
          subscription_id: string
        }
        Insert: {
          amount_brl: number
          created_at?: string
          description?: string | null
          due_date: string
          gateway_invoice_id?: string | null
          id?: string
          metadata?: Json
          paid_at?: string | null
          paroquia_id: string
          payment_method?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          subscription_id: string
        }
        Update: {
          amount_brl?: number
          created_at?: string
          description?: string | null
          due_date?: string
          gateway_invoice_id?: string | null
          id?: string
          metadata?: Json
          paid_at?: string | null
          paroquia_id?: string
          payment_method?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
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
      log_rodizio_resets: {
        Row: {
          created_at: string
          id: string
          motivo: string | null
          paroquia_id: string
          reset_em: string
          reset_por: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          motivo?: string | null
          paroquia_id: string
          reset_em?: string
          reset_por?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          motivo?: string | null
          paroquia_id?: string
          reset_em?: string
          reset_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "log_rodizio_resets_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "log_rodizio_resets_reset_por_fkey"
            columns: ["reset_por"]
            isOneToOne: false
            referencedRelation: "membros"
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
      membro_incompatibilidades: {
        Row: {
          criado_em: string
          id: string
          membro_a_id: string
          membro_b_id: string
          motivo: string | null
          paroquia_id: string
        }
        Insert: {
          criado_em?: string
          id?: string
          membro_a_id: string
          membro_b_id: string
          motivo?: string | null
          paroquia_id: string
        }
        Update: {
          criado_em?: string
          id?: string
          membro_a_id?: string
          membro_b_id?: string
          motivo?: string | null
          paroquia_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membro_incompatibilidades_membro_a_id_fkey"
            columns: ["membro_a_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membro_incompatibilidades_membro_b_id_fkey"
            columns: ["membro_b_id"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "membro_incompatibilidades_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
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
          calendario_preferencia: string | null
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
          whatsapp_opt_in: boolean
          whatsapp_opt_in_at: string | null
          whatsapp_telefone: string | null
        }
        Insert: {
          ativacao_enviada_em?: string | null
          ativo?: boolean
          auth_user_id?: string | null
          calendario_preferencia?: string | null
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
          whatsapp_opt_in?: boolean
          whatsapp_opt_in_at?: string | null
          whatsapp_telefone?: string | null
        }
        Update: {
          ativacao_enviada_em?: string | null
          ativo?: boolean
          auth_user_id?: string | null
          calendario_preferencia?: string | null
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
          whatsapp_opt_in?: boolean
          whatsapp_opt_in_at?: string | null
          whatsapp_telefone?: string | null
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
      missa_padrao_funcoes_extras: {
        Row: {
          created_at: string
          id: string
          ministerio_id: string
          missa_padrao_id: string
          quantidade: number
        }
        Insert: {
          created_at?: string
          id?: string
          ministerio_id: string
          missa_padrao_id: string
          quantidade?: number
        }
        Update: {
          created_at?: string
          id?: string
          ministerio_id?: string
          missa_padrao_id?: string
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "missa_padrao_funcoes_extras_ministerio_id_fkey"
            columns: ["ministerio_id"]
            isOneToOne: false
            referencedRelation: "ministerios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missa_padrao_funcoes_extras_missa_padrao_id_fkey"
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
          rodizio_reset_em: string | null
          rodizio_reset_por: string | null
          substituicao_ativa: boolean
          substituicao_horas_antes: number
          substituicao_prazo_dias: number | null
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
          rodizio_reset_em?: string | null
          rodizio_reset_por?: string | null
          substituicao_ativa?: boolean
          substituicao_horas_antes?: number
          substituicao_prazo_dias?: number | null
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
          rodizio_reset_em?: string | null
          rodizio_reset_por?: string | null
          substituicao_ativa?: boolean
          substituicao_horas_antes?: number
          substituicao_prazo_dias?: number | null
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
          {
            foreignKeyName: "paroquia_config_escalas_rodizio_reset_por_fkey"
            columns: ["rodizio_reset_por"]
            isOneToOne: false
            referencedRelation: "membros"
            referencedColumns: ["id"]
          },
        ]
      }
      paroquias: {
        Row: {
          allow_magic_link: boolean
          blocked_at: string | null
          cidade: string | null
          cnpj: string | null
          contato_email: string | null
          contato_telefone: string | null
          cor_primaria: string | null
          created_at: string
          created_by: string | null
          diocese: string | null
          diocese_id: string | null
          endereco: string | null
          estado: string | null
          id: string
          logo_url: string | null
          nome: string
          padroeiro: string | null
          pdf_cabecalho_url: string | null
          pdf_rodape_url: string | null
          pontuacao_config: Json
          regras_escala: Json
          slug: string
          status: string
          suspension_reason: string | null
          token_portal: string | null
          token_portal_generated_at: string | null
          trial_until: string | null
          updated_at: string
          usa_baculifero: boolean
          usa_mitrifero: boolean
          usa_naveta: boolean
          usa_tochas: boolean
          usa_turibulo: boolean
        }
        Insert: {
          allow_magic_link?: boolean
          blocked_at?: string | null
          cidade?: string | null
          cnpj?: string | null
          contato_email?: string | null
          contato_telefone?: string | null
          cor_primaria?: string | null
          created_at?: string
          created_by?: string | null
          diocese?: string | null
          diocese_id?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          logo_url?: string | null
          nome: string
          padroeiro?: string | null
          pdf_cabecalho_url?: string | null
          pdf_rodape_url?: string | null
          pontuacao_config?: Json
          regras_escala?: Json
          slug: string
          status?: string
          suspension_reason?: string | null
          token_portal?: string | null
          token_portal_generated_at?: string | null
          trial_until?: string | null
          updated_at?: string
          usa_baculifero?: boolean
          usa_mitrifero?: boolean
          usa_naveta?: boolean
          usa_tochas?: boolean
          usa_turibulo?: boolean
        }
        Update: {
          allow_magic_link?: boolean
          blocked_at?: string | null
          cidade?: string | null
          cnpj?: string | null
          contato_email?: string | null
          contato_telefone?: string | null
          cor_primaria?: string | null
          created_at?: string
          created_by?: string | null
          diocese?: string | null
          diocese_id?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          logo_url?: string | null
          nome?: string
          padroeiro?: string | null
          pdf_cabecalho_url?: string | null
          pdf_rodape_url?: string | null
          pontuacao_config?: Json
          regras_escala?: Json
          slug?: string
          status?: string
          suspension_reason?: string | null
          token_portal?: string | null
          token_portal_generated_at?: string | null
          trial_until?: string | null
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
      plan_change_history: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          new_plan_id: string
          old_plan_id: string | null
          paroquia_id: string
          reason: string | null
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_plan_id: string
          old_plan_id?: string | null
          paroquia_id: string
          reason?: string | null
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_plan_id?: string
          old_plan_id?: string | null
          paroquia_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plan_change_history_new_plan_id_fkey"
            columns: ["new_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_change_history_old_plan_id_fkey"
            columns: ["old_plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_change_history_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_features: {
        Row: {
          enabled: boolean
          feature_key: string
          id: string
          limit_value: number | null
          plan_id: string
        }
        Insert: {
          enabled?: boolean
          feature_key: string
          id?: string
          limit_value?: number | null
          plan_id: string
        }
        Update: {
          enabled?: boolean
          feature_key?: string
          id?: string
          limit_value?: number | null
          plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_features_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          destaque: boolean
          id: string
          max_coordenadores: number | null
          max_membros: number | null
          nome: string
          ordem: number
          preco_anual: number | null
          preco_mensal: number | null
          slug: string
          trial_dias: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          destaque?: boolean
          id?: string
          max_coordenadores?: number | null
          max_membros?: number | null
          nome: string
          ordem?: number
          preco_anual?: number | null
          preco_mensal?: number | null
          slug: string
          trial_dias?: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          destaque?: boolean
          id?: string
          max_coordenadores?: number | null
          max_membros?: number | null
          nome?: string
          ordem?: number
          preco_anual?: number | null
          preco_mensal?: number | null
          slug?: string
          trial_dias?: number
        }
        Relationships: []
      }
      platform_audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          id: string
          ip_address: unknown
          metadata: Json
          new_value: Json | null
          old_value: Json | null
          target_id: string | null
          target_label: string | null
          target_type: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          new_value?: Json | null
          old_value?: Json | null
          target_id?: string | null
          target_label?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          new_value?: Json | null
          old_value?: Json | null
          target_id?: string | null
          target_label?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      presencas_eventos: {
        Row: {
          confirmado_pelo_membro: boolean
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
          confirmado_pelo_membro?: boolean
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
          confirmado_pelo_membro?: boolean
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
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string
          p256dh: string
          paroquia_id: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string
          p256dh: string
          paroquia_id: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string
          p256dh?: string
          paroquia_id?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_paroquia_id_fkey"
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
      subscription_alerts: {
        Row: {
          alert_type: string
          id: string
          paroquia_id: string
          sent_at: string
          sent_date: string
          sent_to_email: string | null
        }
        Insert: {
          alert_type: string
          id?: string
          paroquia_id: string
          sent_at?: string
          sent_date?: string
          sent_to_email?: string | null
        }
        Update: {
          alert_type?: string
          id?: string
          paroquia_id?: string
          sent_at?: string
          sent_date?: string
          sent_to_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_alerts_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_cycle: string
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          gateway: string | null
          gateway_customer_id: string | null
          gateway_subscription_id: string | null
          id: string
          metadata: Json
          next_billing_date: string | null
          paroquia_id: string
          past_due_since: string | null
          plan_id: string
          price_brl: number | null
          status: Database["public"]["Enums"]["sub_status"]
          trial_until: string | null
          updated_at: string
        }
        Insert: {
          billing_cycle?: string
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          gateway?: string | null
          gateway_customer_id?: string | null
          gateway_subscription_id?: string | null
          id?: string
          metadata?: Json
          next_billing_date?: string | null
          paroquia_id: string
          past_due_since?: string | null
          plan_id: string
          price_brl?: number | null
          status?: Database["public"]["Enums"]["sub_status"]
          trial_until?: string | null
          updated_at?: string
        }
        Update: {
          billing_cycle?: string
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          gateway?: string | null
          gateway_customer_id?: string | null
          gateway_subscription_id?: string | null
          id?: string
          metadata?: Json
          next_billing_date?: string | null
          paroquia_id?: string
          past_due_since?: string | null
          plan_id?: string
          price_brl?: number | null
          status?: Database["public"]["Enums"]["sub_status"]
          trial_until?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: true
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      substituicoes: {
        Row: {
          aberta_para_membros: boolean
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
          aberta_para_membros?: boolean
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
          aberta_para_membros?: boolean
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
          solene: boolean
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
          solene?: boolean
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
          solene?: boolean
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
      webhook_events: {
        Row: {
          event_type: string
          gateway: string
          id: string
          idempotency_key: string
          payload: Json
          processed: boolean
          processed_at: string | null
          processing_error: string | null
          received_at: string
          related_paroquia_id: string | null
          retry_count: number
        }
        Insert: {
          event_type: string
          gateway: string
          id?: string
          idempotency_key: string
          payload: Json
          processed?: boolean
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
          related_paroquia_id?: string | null
          retry_count?: number
        }
        Update: {
          event_type?: string
          gateway?: string
          id?: string
          idempotency_key?: string
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
          related_paroquia_id?: string | null
          retry_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_related_paroquia_id_fkey"
            columns: ["related_paroquia_id"]
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
      _cfg_anon_key: { Args: never; Returns: string }
      _cfg_supabase_url: { Args: never; Returns: string }
      _edge_fn_url: { Args: { p_fn: string }; Returns: string }
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
      admin_deletar_paroquia: {
        Args: { p_paroquia_id: string }
        Returns: undefined
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
      admin_remover_membro_escala: {
        Args: {
          p_abrir_vaga?: boolean
          p_escala_membro_id: string
          p_motivo?: string
          p_penalidade?: string
        }
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
      admin_set_membro_acesso: {
        Args: { p_membro_id: string; p_tipo_acesso: string }
        Returns: Json
      }
      admin_vincular_auth_membro: {
        Args: { p_membro_id: string }
        Returns: Json
      }
      ativar_conta_membro: { Args: never; Returns: Json }
      atualizar_consentimento_whatsapp: {
        Args: { p_opt_in: boolean; p_telefone?: string }
        Returns: Json
      }
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
      check_feature_limit: {
        Args: { p_current_count: number; p_feature: string }
        Returns: boolean
      }
      check_magic_link_allowed: { Args: { p_email: string }; Returns: boolean }
      check_plan_feature: { Args: { p_feature: string }; Returns: boolean }
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
          aberta_para_membros: boolean
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
          solene: boolean
          solicitante_nome: string
          status: string
          substituto_nome: string
        }[]
      }
      coord_liberar_vaga_substituicao: {
        Args: { p_substituicao_id: string }
        Returns: Json
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
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      delete_push_subscription: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      enviar_alerta_confirmacao: {
        Args: { p_escala_membro_id: string }
        Returns: Json
      }
      enviar_lembretes_presenca: { Args: never; Returns: undefined }
      expirar_substituicoes_vencidas: {
        Args: { p_paroquia_id?: string }
        Returns: Json
      }
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
      get_oportunidades_por_membro: {
        Args: {
          p_janela_semanas?: number
          p_ministerio_id: string
          p_paroquia_id: string
        }
        Returns: {
          escalas_recebidas: number
          membro_id: string
          membro_nome: string
          oportunidades: number
        }[]
      }
      get_ranking_completo: {
        Args: { p_paroquia_id: string }
        Returns: {
          id: string
          ministerios: Json
          nome: string
          score: number
          taxa_presenca: number
          total_convocacoes: number
          total_faltas: number
          total_presencas: number
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
      paroquia_is_accessible: { Args: never; Returns: boolean }
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
      portal_get_substituicoes_abertas: {
        Args: never
        Returns: {
          created_at: string
          escala_data: string
          escala_titulo: string
          id: string
          ministerio_cor: string
          ministerio_nome: string
          motivo_solicitacao: string
          solicitante_nome: string
          status: string
        }[]
      }
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
      portal_membro_get_escalas_publicadas: { Args: never; Returns: Json }
      portal_membro_get_historico: { Args: never; Returns: Json }
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
      registrar_substituto_retroativo: {
        Args: { p_escala_membro_id: string; p_substituto_id: string }
        Returns: Json
      }
      resetar_rodizio_solene: {
        Args: { p_motivo?: string; p_paroquia_id: string }
        Returns: Json
      }
      rotacionar_token_portal: {
        Args: { p_paroquia_id: string }
        Returns: Json
      }
      saas_approve_paroquia: {
        Args: {
          p_plan_slug?: string
          p_solicitacao_id: string
          p_trial_dias?: number
        }
        Returns: string
      }
      saas_block_paroquia: {
        Args: { p_motivo?: string; p_paroquia_id: string }
        Returns: undefined
      }
      saas_change_plan: {
        Args: {
          p_new_plan_slug: string
          p_paroquia_id: string
          p_reason?: string
        }
        Returns: undefined
      }
      saas_create_impersonate_token: {
        Args: { p_paroquia_id: string; p_reason: string }
        Returns: string
      }
      saas_get_platform_metrics: { Args: never; Returns: Json }
      saas_reprocess_webhook: {
        Args: { p_event_id: string }
        Returns: undefined
      }
      saas_suspend_paroquia: {
        Args: { p_paroquia_id: string; p_reason: string }
        Returns: undefined
      }
      salvar_presencas_escala: {
        Args: { p_escala_id: string; p_updates: Json }
        Returns: undefined
      }
      set_active_gateway: { Args: { p_gateway: string }; Returns: undefined }
      store_admin_mfa_code: {
        Args: { p_code_hash: string; p_user_email: string }
        Returns: undefined
      }
      sync_homilia_diaria: { Args: never; Returns: undefined }
      sync_homilia_se_ausente: { Args: never; Returns: undefined }
      upsert_push_subscription: {
        Args: {
          p_auth_key: string
          p_endpoint: string
          p_p256dh: string
          p_paroquia_id: string
          p_user_agent?: string
        }
        Returns: string
      }
      verify_admin_mfa_code: { Args: { p_code: string }; Returns: Json }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "admin_paroquial"
        | "lider"
        | "servidor"
        | "coordenador"
      sub_status:
        | "trial"
        | "active"
        | "past_due"
        | "suspended"
        | "canceled"
        | "blocked"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      sub_status: [
        "trial",
        "active",
        "past_due",
        "suspended",
        "canceled",
        "blocked",
      ],
    },
  },
} as const
