# Firebase na prod projektu, Hosting site pro veřejnou kalkulačku a vlastní doména.
#
# Pokud Firebase na projekt přidal už ten, kdo projekt zakládal, create skončí chybou 409.
# Pak stačí zdroj importovat:  terraform import google_firebase_project.this projects/<PROJECT_ID>
resource "google_firebase_project" "this" {
  provider   = google-beta
  project    = var.project_id
  depends_on = [google_project_service.enabled]
}

# Vlastní site místo výchozí: ID známe dopředu, takže firebase.json ho může mít natvrdo.
resource "google_firebase_hosting_site" "public" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.hosting_site_id

  depends_on = [google_firebase_project.this]

  lifecycle {
    # smazání site vypne web a uvolní jeho ID pro kohokoli dalšího
    prevent_destroy = true
  }
}

# Firebase po vytvoření vypíše DNS záznamy pro správce DNS (output custom_domain_dns_records).
# Na Cloudflare musí být záznamy „DNS only“ (šedý mráček), jinak se certifikát nevydá.
resource "google_firebase_hosting_custom_domain" "public" {
  provider = google-beta
  count    = var.custom_domain == "" ? 0 : 1

  project               = var.project_id
  site_id               = google_firebase_hosting_site.public.site_id
  custom_domain         = var.custom_domain
  wait_dns_verification = false
}
