-- Important Links table
CREATE TABLE IF NOT EXISTS launcher_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  icon_url TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at
DROP TRIGGER IF EXISTS launcher_links_updated_at ON launcher_links;
CREATE TRIGGER launcher_links_updated_at
  BEFORE UPDATE ON launcher_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE launcher_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Links readable by authenticated users"
  ON launcher_links FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Links writable by admins"
  ON launcher_links FOR ALL
  TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- Seed some default links
INSERT INTO launcher_links (name, description, url, icon_url, display_order) VALUES
  ('Adobe Acrobat Reader', 'Free PDF viewer download', 'https://get.adobe.com/reader/', 'https://www.adobe.com/favicon.ico', 1),
  ('Malwarebytes', 'Anti-malware protection download', 'https://www.malwarebytes.com/mwb-download', 'https://www.malwarebytes.com/favicon-32x32.png', 2),
  ('Slack', 'Team messaging app download', 'https://slack.com/downloads', 'https://a.slack-edge.com/80588/marketing/img/meta/favicon-32.png', 3),
  ('Google Chrome', 'Web browser download', 'https://www.google.com/chrome/', 'https://www.google.com/chrome/static/images/favicons/favicon-32x32.png', 4),
  ('Google Meet', 'Video conferencing & calls', 'https://meet.google.com/', 'https://fonts.gstatic.com/s/i/productlogos/meet_2020q4/v1/web-32dp/logo_meet_2020q4_color_1x_web_32dp.png', 5),
  ('ADP', 'Payroll, HR & time tracking', 'https://online.adp.com/', 'https://www.adp.com/favicon.ico', 6);
