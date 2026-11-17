# Nasazování z GitHub Actions přes Workload Identity Federation. Žádné JSON klíče.
#
# Repozitář je veřejný. GitHub nevydá OIDC token workflow z PR z forku, takže cizí PR se k účtu nedostane.
# Token ale dostane každý workflow v tomto repozitáři (i z vedlejší větve), proto náhled i live sdílí
# jeden účet: oddělit je jde jen ochranou na straně GitHubu (prostředí production se schvalováním).

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "Nasazování ${var.github_repository} z GitHub Actions."
  depends_on                = [google_project_service.enabled]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository"          = "assertion.repository"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
  }

  # Číselná ID místo jména: po přejmenování nebo převodu repozitáře nemůže stejné jméno získat jiný repozitář.
  attribute_condition = "assertion.repository_id == '${var.github_repository_id}' && assertion.repository_owner_id == '${var.github_repository_owner_id}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "hosting_deployer" {
  project      = var.project_id
  account_id   = "hosting-deployer"
  display_name = "Creative Scaler: nasazení Firebase Hosting z GitHub Actions"
}

resource "google_service_account_iam_member" "hosting_deployer_wif" {
  service_account_id = google_service_account.hosting_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/${var.github_repository_id}"
}

# Jen Hosting. Fáze 2 (přepis /api/** na Cloud Run) přidá roles/run.viewer.
resource "google_project_iam_member" "hosting_deployer_hosting_admin" {
  project = var.project_id
  role    = "roles/firebasehosting.admin"
  member  = "serviceAccount:${google_service_account.hosting_deployer.email}"
}
