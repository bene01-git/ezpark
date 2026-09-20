/* Crowd-report configuration.
 *
 * Leave these blank and the app works exactly as before, just without the
 * "report full / open" buttons. To turn on crowdsourced fullness:
 *
 *   1. Create a free project at https://supabase.com
 *   2. Run supabase/schema.sql in the Supabase SQL editor
 *   3. In Supabase: Settings -> API. Copy the Project URL and the anon public
 *      key into the two fields below, then commit and push.
 *
 * The anon key is meant to be public - it's safe in the browser because the
 * database policies only allow inserting and reading reports.
 */
window.SU_PARKING_CONFIG = {
  SUPABASE_URL: "",       // e.g. "https://abcdefgh.supabase.co"
  SUPABASE_ANON_KEY: "",  // the anon / public key (NOT the service_role key)

  // How many minutes a crowd report stays "recent".
  REPORT_WINDOW_MIN: 90,
  // Minimum minutes between reports from this browser for the same lot.
  REPORT_COOLDOWN_MIN: 5,
};
