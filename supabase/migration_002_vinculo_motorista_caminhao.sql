-- Vínculo 1-para-1 entre motorista e caminhão: cada caminhão pode ter um
-- motorista "dono" (opcional). Um motorista só pode estar vinculado a UM
-- caminhão por vez (unique) — a trava fica no lado do caminhão, não do
-- motorista, porque cada caminhão físico tem um único operador fixo.
--
-- Postgres permite múltiplas linhas com motorista_id = null numa coluna
-- unique (null nunca é igual a null pra essa checagem), então caminhões
-- ainda sem motorista vinculado não são afetados pela trava.

alter table public.caminhoes
  add column if not exists motorista_id uuid references public.profiles(id) on delete set null;

alter table public.caminhoes
  add constraint caminhoes_motorista_id_key unique (motorista_id);
