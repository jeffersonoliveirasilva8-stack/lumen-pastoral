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
      paroquias: {
        Row: {
          contato_email: string | null
          contato_telefone: string | null
          cor_primaria: string | null
          created_at: string
          created_by: string | null
          diocese: string | null
          endereco: string | null
          id: string
          logo_url: string | null
          pdf_cabecalho_url: string | null
          pdf_rodape_url: string | null
          nome: string
          padroeiro: string | null
          cidade: string | null
          slug: string
          updated_at: string
          usa_tochas: boolean
          usa_turibulo: boolean
          usa_naveta: boolean
          usa_baculifero: boolean
          usa_mitrifero: boolean
          regras_escala: Json
        }
        Insert: {
          contato_email?: string | null
          contato_telefone?: string | null
          cor_primaria?: string | null
          created_at?: string
          created_by?: string | null
          diocese?: string | null
          endereco?: string | null
          id?: string
          logo_url?: string | null
          pdf_cabecalho_url?: string | null
          pdf_rodape_url?: string | null
          nome: string
          padroeiro?: string | null
          cidade?: string | null
          slug: string
          updated_at?: string
          usa_tochas?: boolean
          usa_turibulo?: boolean
          usa_naveta?: boolean
          usa_baculifero?: boolean
          usa_mitrifero?: boolean
          regras_escala?: Json
        }
        Update: {
          contato_email?: string | null
          contato_telefone?: string | null
          cor_primaria?: string | null
          created_at?: string
          created_by?: string | null
          diocese?: string | null
          endereco?: string | null
          id?: string
          logo_url?: string | null
          pdf_cabecalho_url?: string | null
          pdf_rodape_url?: string | null
          nome?: string
          padroeiro?: string | null
          cidade?: string | null
          slug?: string
          updated_at?: string
          usa_tochas?: boolean
          usa_turibulo?: boolean
          usa_naveta?: boolean
          usa_baculifero?: boolean
          usa_mitrifero?: boolean
          regras_escala?: Json
        }
        Relationships: []
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
      ministerios: {
        Row: {
          id: string
          paroquia_id: string
          nome: string
          descricao: string | null
          cor: string
          ativo: boolean
          ordem: number
          categoria: string | null
          icone: string | null
          pontuacao_minima: number
          exigir_experiencia: boolean
          mostrar_no_portal: boolean
          quantidade_padrao: number
          auto_adicionar: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          paroquia_id: string
          nome: string
          descricao?: string | null
          cor?: string
          ativo?: boolean
          ordem?: number
          categoria?: string | null
          icone?: string | null
          pontuacao_minima?: number
          exigir_experiencia?: boolean
          mostrar_no_portal?: boolean
          quantidade_padrao?: number
          auto_adicionar?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          paroquia_id?: string
          nome?: string
          descricao?: string | null
          cor?: string
          ativo?: boolean
          ordem?: number
          categoria?: string | null
          icone?: string | null
          pontuacao_minima?: number
          exigir_experiencia?: boolean
          mostrar_no_portal?: boolean
          quantidade_padrao?: number
          auto_adicionar?: boolean
          created_at?: string
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
      membros: {
        Row: {
          id: string
          paroquia_id: string
          profile_id: string | null
          nome: string
          email: string | null
          telefone: string | null
          data_nascimento: string | null
          data_ingresso: string | null
          observacoes: string | null
          ativo: boolean
          score: number
          forcar_escalacao_solene: boolean
          prioridade_escala: string
          token_acesso: string | null
          sexo: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          paroquia_id: string
          profile_id?: string | null
          nome: string
          email?: string | null
          telefone?: string | null
          data_nascimento?: string | null
          data_ingresso?: string | null
          observacoes?: string | null
          ativo?: boolean
          score?: number
          forcar_escalacao_solene?: boolean
          prioridade_escala?: string
          token_acesso?: string | null
          sexo?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          paroquia_id?: string
          profile_id?: string | null
          nome?: string
          email?: string | null
          telefone?: string | null
          data_nascimento?: string | null
          data_ingresso?: string | null
          observacoes?: string | null
          ativo?: boolean
          score?: number
          forcar_escalacao_solene?: boolean
          prioridade_escala?: string
          token_acesso?: string | null
          sexo?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "membros_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      membro_ministerios: {
        Row: {
          id: string
          membro_id: string
          ministerio_id: string
          nivel: string
          created_at: string
        }
        Insert: {
          id?: string
          membro_id: string
          ministerio_id: string
          nivel?: string
          created_at?: string
        }
        Update: {
          id?: string
          membro_id?: string
          ministerio_id?: string
          nivel?: string
          created_at?: string
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
      escalas: {
        Row: {
          id: string
          paroquia_id: string
          titulo: string
          data: string
          hora_inicio: string | null
          hora_fim: string | null
          local: string | null
          tipo: string
          tipo_missa_id: string | null
          status: string
          observacoes: string | null
          solene: boolean
          tem_adoracao: boolean
          tem_bispo: boolean
          token_publico: string
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          paroquia_id: string
          titulo: string
          data: string
          hora_inicio?: string | null
          hora_fim?: string | null
          local?: string | null
          tipo?: string
          tipo_missa_id?: string | null
          status?: string
          observacoes?: string | null
          solene?: boolean
          tem_adoracao?: boolean
          tem_bispo?: boolean
          token_publico?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          paroquia_id?: string
          titulo?: string
          data?: string
          hora_inicio?: string | null
          hora_fim?: string | null
          local?: string | null
          tipo?: string
          tipo_missa_id?: string | null
          status?: string
          observacoes?: string | null
          solene?: boolean
          tem_adoracao?: boolean
          tem_bispo?: boolean
          token_publico?: string
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "escalas_paroquia_id_fkey"
            columns: ["paroquia_id"]
            isOneToOne: false
            referencedRelation: "paroquias"
            referencedColumns: ["id"]
          },
        ]
      }
      escala_funcoes: {
        Row: {
          id: string
          escala_id: string
          ministerio_id: string
          quantidade: number
        }
        Insert: {
          id?: string
          escala_id: string
          ministerio_id: string
          quantidade?: number
        }
        Update: {
          id?: string
          escala_id?: string
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
      escala_ocorrencias: {
        Row: {
          id: string
          escala_id: string
          membro_id: string | null
          registrado_por: string
          tipo: string
          descricao: string
          created_at: string
        }
        Insert: {
          id?: string
          escala_id: string
          membro_id?: string | null
          registrado_por: string
          tipo: string
          descricao: string
          created_at?: string
        }
        Update: {
          id?: string
          escala_id?: string
          membro_id?: string | null
          registrado_por?: string
          tipo?: string
          descricao?: string
          created_at?: string
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
      escala_membros: {
        Row: {
          id: string
          escala_id: string
          membro_id: string
          ministerio_id: string
          status: string
          justificativa: string | null
          created_at: string
        }
        Insert: {
          id?: string
          escala_id: string
          membro_id: string
          ministerio_id: string
          status?: string
          justificativa?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          escala_id?: string
          membro_id?: string
          ministerio_id?: string
          status?: string
          justificativa?: string | null
          created_at?: string
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
        ]
      }
      indisponibilidades: {
        Row: {
          id: string
          paroquia_id: string
          membro_id: string
          data: string
          motivo: string | null
          created_at: string
        }
        Insert: {
          id?: string
          paroquia_id: string
          membro_id: string
          data: string
          motivo?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          paroquia_id?: string
          membro_id?: string
          data?: string
          motivo?: string | null
          created_at?: string
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
      historico_participacoes: {
        Row: {
          id: string
          paroquia_id: string
          membro_id: string
          escala_id: string
          ministerio_id: string
          presenca: string
          data: string
          pontos: number
          created_at: string
        }
        Insert: {
          id?: string
          paroquia_id: string
          membro_id: string
          escala_id: string
          ministerio_id: string
          presenca?: string
          data: string
          pontos?: number
          created_at?: string
        }
        Update: {
          id?: string
          paroquia_id?: string
          membro_id?: string
          escala_id?: string
          ministerio_id?: string
          presenca?: string
          data?: string
          pontos?: number
          created_at?: string
        }
        Relationships: []
      }
      missas_padrao: {
        Row: {
          id: string
          paroquia_id: string
          nome: string
          dia_semana: number
          hora_inicio: string | null
          hora_fim: string | null
          local: string | null
          tipo: string
          tipo_missa_id: string | null
          recorrencia: Json
          observacoes: string | null
          solene: boolean
          tem_adoracao: boolean
          tem_bispo: boolean
          ativo: boolean
          ordem: number
          created_at: string
        }
        Insert: {
          id?: string
          paroquia_id: string
          nome: string
          dia_semana: number
          hora_inicio?: string | null
          hora_fim?: string | null
          local?: string | null
          tipo?: string
          tipo_missa_id?: string | null
          recorrencia?: Json
          observacoes?: string | null
          solene?: boolean
          tem_adoracao?: boolean
          tem_bispo?: boolean
          ativo?: boolean
          ordem?: number
          created_at?: string
        }
        Update: {
          id?: string
          paroquia_id?: string
          nome?: string
          dia_semana?: number
          hora_inicio?: string | null
          hora_fim?: string | null
          local?: string | null
          tipo?: string
          tipo_missa_id?: string | null
          recorrencia?: Json
          observacoes?: string | null
          solene?: boolean
          tem_adoracao?: boolean
          tem_bispo?: boolean
          ativo?: boolean
          ordem?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "missas_padrao_paroquia_id_fkey"
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
          missa_padrao_id: string
          ministerio_id: string
          quantidade: number
        }
        Insert: {
          id?: string
          missa_padrao_id: string
          ministerio_id: string
          quantidade?: number
        }
        Update: {
          id?: string
          missa_padrao_id?: string
          ministerio_id?: string
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "missa_padrao_funcoes_missa_padrao_id_fkey"
            columns: ["missa_padrao_id"]
            isOneToOne: false
            referencedRelation: "missas_padrao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "missa_padrao_funcoes_ministerio_id_fkey"
            columns: ["ministerio_id"]
            isOneToOne: false
            referencedRelation: "ministerios"
            referencedColumns: ["id"]
          },
        ]
      }
      atuacoes_pastorais: {
        Row: {
          id: string
          paroquia_id: string
          nome: string
          descricao: string | null
          cor: string
          icone: string | null
          ativo: boolean
          ordem: number
          created_at: string
        }
        Insert: {
          id?: string
          paroquia_id: string
          nome: string
          descricao?: string | null
          cor?: string
          icone?: string | null
          ativo?: boolean
          ordem?: number
          created_at?: string
        }
        Update: {
          id?: string
          paroquia_id?: string
          nome?: string
          descricao?: string | null
          cor?: string
          icone?: string | null
          ativo?: boolean
          ordem?: number
          created_at?: string
        }
        Relationships: []
      }
      membro_atuacoes: {
        Row: {
          id: string
          membro_id: string
          atuacao_id: string
        }
        Insert: {
          id?: string
          membro_id: string
          atuacao_id: string
        }
        Update: {
          id?: string
          membro_id?: string
          atuacao_id?: string
        }
        Relationships: []
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
        Relationships: []
      }
      coordenadores: {
        Row: {
          id: string
          paroquia_id: string
          membro_id: string | null
          nome: string
          funcao_pastoral: string | null
          atua_como: string | null
          email: string | null
          telefone: string | null
          comunidade: string | null
          observacoes: string | null
          ativo: boolean
          criado_em: string
          atualizado_em: string
        }
        Insert: {
          id?: string
          paroquia_id: string
          membro_id?: string | null
          nome: string
          funcao_pastoral?: string | null
          atua_como?: string | null
          email?: string | null
          telefone?: string | null
          comunidade?: string | null
          observacoes?: string | null
          ativo?: boolean
          criado_em?: string
          atualizado_em?: string
        }
        Update: {
          id?: string
          paroquia_id?: string
          membro_id?: string | null
          nome?: string
          funcao_pastoral?: string | null
          atua_como?: string | null
          email?: string | null
          telefone?: string | null
          comunidade?: string | null
          observacoes?: string | null
          ativo?: boolean
          criado_em?: string
          atualizado_em?: string
        }
        Relationships: []
      }
      comunidades: {
        Row: {
          id: string
          paroquia_id: string
          nome: string
          tipo: string
          endereco: string | null
          responsavel: string | null
          ativo: boolean
          criado_em: string
          atualizado_em: string
        }
        Insert: {
          id?: string
          paroquia_id: string
          nome: string
          tipo?: string
          endereco?: string | null
          responsavel?: string | null
          ativo?: boolean
          criado_em?: string
          atualizado_em?: string
        }
        Update: {
          id?: string
          paroquia_id?: string
          nome?: string
          tipo?: string
          endereco?: string | null
          responsavel?: string | null
          ativo?: boolean
          criado_em?: string
          atualizado_em?: string
        }
        Relationships: []
      }
      tipos_missa: {
        Row: {
          id: string
          paroquia_id: string
          nome: string
          descricao: string | null
          cor: string
          icone: string | null
          usa_turibulo: boolean
          usa_naveta: boolean
          usa_baculifero: boolean
          usa_mitrifero: boolean
          prioridade_liturgica: number
          ativo: boolean
          ordem: number
          created_at: string
        }
        Insert: {
          id?: string
          paroquia_id: string
          nome: string
          descricao?: string | null
          cor?: string
          icone?: string | null
          usa_turibulo?: boolean
          usa_naveta?: boolean
          usa_baculifero?: boolean
          usa_mitrifero?: boolean
          prioridade_liturgica?: number
          ativo?: boolean
          ordem?: number
          created_at?: string
        }
        Update: {
          id?: string
          paroquia_id?: string
          nome?: string
          descricao?: string | null
          cor?: string
          icone?: string | null
          usa_turibulo?: boolean
          usa_naveta?: boolean
          usa_baculifero?: boolean
          usa_mitrifero?: boolean
          prioridade_liturgica?: number
          ativo?: boolean
          ordem?: number
          created_at?: string
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
      tipo_missa_funcoes: {
        Row: {
          id: string
          tipo_missa_id: string
          ministerio_id: string
          tipo_vinculo: string
          quantidade_min: number
          quantidade_max: number
          prioridade: number
        }
        Insert: {
          id?: string
          tipo_missa_id: string
          ministerio_id: string
          tipo_vinculo?: string
          quantidade_min?: number
          quantidade_max?: number
          prioridade?: number
        }
        Update: {
          id?: string
          tipo_missa_id?: string
          ministerio_id?: string
          tipo_vinculo?: string
          quantidade_min?: number
          quantidade_max?: number
          prioridade?: number
        }
        Relationships: [
          {
            foreignKeyName: "tipo_missa_funcoes_tipo_missa_id_fkey"
            columns: ["tipo_missa_id"]
            isOneToOne: false
            referencedRelation: "tipos_missa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tipo_missa_funcoes_ministerio_id_fkey"
            columns: ["ministerio_id"]
            isOneToOne: false
            referencedRelation: "ministerios"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_paroquia_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      portal_get_membro: {
        Args: { p_token: string }
        Returns: Json
      }
      portal_get_escalas_membro: {
        Args: { p_token: string }
        Returns: Json
      }
      portal_get_historico_membro: {
        Args: { p_token: string }
        Returns: Json
      }
      portal_get_indisponibilidades_membro: {
        Args: { p_token: string }
        Returns: Json
      }
      portal_responder_escala: {
        Args: { p_token: string; p_escala_membro_id: string; p_status: string; p_justificativa?: string }
        Returns: Json
      }
      portal_add_indisponibilidade: {
        Args: { p_token: string; p_data: string; p_motivo?: string }
        Returns: string
      }
      portal_remove_indisponibilidade: {
        Args: { p_token: string; p_indisp_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "super_admin" | "admin_paroquial" | "lider" | "servidor"
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
      app_role: ["super_admin", "admin_paroquial", "lider", "servidor"],
    },
  },
} as const
