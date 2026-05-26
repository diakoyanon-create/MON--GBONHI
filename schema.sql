-- ============================================================
-- MON GBONHI — Schéma Supabase complet
-- Coller ce code dans : Supabase > SQL Editor > New Query
-- ============================================================

-- 1. TABLE PROFILS (liée à auth.users de Supabase)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  bio TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  votes_given INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABLE PROBLÈMES
CREATE TABLE problems (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('amour','business','famille','sante','social')),
  expires_at TIMESTAMPTZ NOT NULL,
  total_votes INTEGER DEFAULT 0,
  is_closed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABLE OPTIONS DE VOTE
CREATE TABLE options (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  problem_id UUID REFERENCES problems(id) ON DELETE CASCADE NOT NULL,
  text TEXT NOT NULL,
  votes_count INTEGER DEFAULT 0,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABLE VOTES
CREATE TABLE votes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  problem_id UUID REFERENCES problems(id) ON DELETE CASCADE NOT NULL,
  option_id UUID REFERENCES options(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, problem_id)  -- un seul vote par utilisateur par problème
);

-- 5. TABLE COMMENTAIRES
CREATE TABLE comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  problem_id UUID REFERENCES problems(id) ON DELETE CASCADE NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TABLE BADGES
CREATE TABLE badges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  awarded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- VUES UTILES
-- ============================================================

-- Vue : problèmes enrichis avec infos auteur
CREATE OR REPLACE VIEW problems_full AS
SELECT
  p.*,
  pr.display_name AS author_name,
  pr.username AS author_username,
  pr.avatar_url AS author_avatar,
  (SELECT COUNT(*) FROM comments c WHERE c.problem_id = p.id) AS comments_count
FROM problems p
JOIN profiles pr ON p.user_id = pr.id;

-- Vue : options avec pourcentages
CREATE OR REPLACE VIEW options_with_pct AS
SELECT
  o.*,
  p.total_votes,
  CASE WHEN p.total_votes > 0
    THEN ROUND((o.votes_count::DECIMAL / p.total_votes) * 100)
    ELSE 0
  END AS percentage
FROM options o
JOIN problems p ON o.problem_id = p.id;

-- ============================================================
-- FONCTIONS
-- ============================================================

-- Fonction : voter ou changer de vote
CREATE OR REPLACE FUNCTION cast_vote(
  p_user_id UUID,
  p_problem_id UUID,
  p_option_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing_vote UUID;
  old_option_id UUID;
BEGIN
  -- Vérifier si le problème est encore ouvert
  IF (SELECT is_closed FROM problems WHERE id = p_problem_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vote clos');
  END IF;

  -- Chercher un vote existant
  SELECT id, option_id INTO existing_vote, old_option_id
  FROM votes WHERE user_id = p_user_id AND problem_id = p_problem_id;

  IF existing_vote IS NOT NULL THEN
    IF old_option_id = p_option_id THEN
      -- Même option : annuler le vote
      DELETE FROM votes WHERE id = existing_vote;
      UPDATE options SET votes_count = votes_count - 1 WHERE id = old_option_id;
      UPDATE problems SET total_votes = total_votes - 1 WHERE id = p_problem_id;
      RETURN jsonb_build_object('success', true, 'action', 'removed');
    ELSE
      -- Autre option : changer le vote
      UPDATE votes SET option_id = p_option_id WHERE id = existing_vote;
      UPDATE options SET votes_count = votes_count - 1 WHERE id = old_option_id;
      UPDATE options SET votes_count = votes_count + 1 WHERE id = p_option_id;
      RETURN jsonb_build_object('success', true, 'action', 'changed');
    END IF;
  ELSE
    -- Nouveau vote
    INSERT INTO votes (user_id, problem_id, option_id) VALUES (p_user_id, p_problem_id, p_option_id);
    UPDATE options SET votes_count = votes_count + 1 WHERE id = p_option_id;
    UPDATE problems SET total_votes = total_votes + 1 WHERE id = p_problem_id;
    UPDATE profiles SET votes_given = votes_given + 1 WHERE id = p_user_id;
    RETURN jsonb_build_object('success', true, 'action', 'voted');
  END IF;
END;
$$;

-- Fonction : fermer automatiquement les votes expirés
CREATE OR REPLACE FUNCTION close_expired_problems()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE problems SET is_closed = TRUE
  WHERE expires_at < NOW() AND is_closed = FALSE;
END;
$$;

-- Trigger : créer profil automatiquement après inscription
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO profiles (id, username, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || LEFT(NEW.id::TEXT, 8)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', 'Nouvel utilisateur')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- SÉCURITÉ (Row Level Security)
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE options ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;

-- Profils : tout le monde peut lire, chacun gère le sien
CREATE POLICY "Profils publics" ON profiles FOR SELECT USING (true);
CREATE POLICY "Modifier son profil" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Problèmes : tout le monde lit, connectés créent
CREATE POLICY "Problèmes publics" ON problems FOR SELECT USING (true);
CREATE POLICY "Créer un problème" ON problems FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Modifier son problème" ON problems FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Supprimer son problème" ON problems FOR DELETE USING (auth.uid() = user_id);

-- Options : tout le monde lit, propriétaire du problème gère
CREATE POLICY "Options publiques" ON options FOR SELECT USING (true);
CREATE POLICY "Créer des options" ON options FOR INSERT WITH CHECK (
  auth.uid() = (SELECT user_id FROM problems WHERE id = problem_id)
);

-- Votes : tout le monde lit, connectés votent
CREATE POLICY "Votes publics" ON votes FOR SELECT USING (true);
CREATE POLICY "Voter" ON votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Modifier son vote" ON votes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Supprimer son vote" ON votes FOR DELETE USING (auth.uid() = user_id);

-- Commentaires
CREATE POLICY "Commentaires publics" ON comments FOR SELECT USING (true);
CREATE POLICY "Commenter" ON comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Supprimer son commentaire" ON comments FOR DELETE USING (auth.uid() = user_id);

-- Badges
CREATE POLICY "Badges publics" ON badges FOR SELECT USING (true);

-- ============================================================
-- INDEX pour la performance
-- ============================================================
CREATE INDEX idx_problems_category ON problems(category);
CREATE INDEX idx_problems_created_at ON problems(created_at DESC);
CREATE INDEX idx_problems_expires_at ON problems(expires_at);
CREATE INDEX idx_options_problem_id ON options(problem_id);
CREATE INDEX idx_votes_problem_id ON votes(problem_id);
CREATE INDEX idx_votes_user_problem ON votes(user_id, problem_id);
CREATE INDEX idx_comments_problem_id ON comments(problem_id);

-- ============================================================
-- DONNÉES DE TEST (optionnel)
-- ============================================================
-- (À exécuter après avoir créé un vrai compte utilisateur)
-- INSERT INTO problems (user_id, title, category, expires_at) VALUES
-- ('ton-uuid-ici', 'Mon copain veut partir en France...', 'amour', NOW() + INTERVAL '24 hours');
