# Nasazování z GitHub Actions přes Workload Identity Federation. Žádné JSON klíče.
#
# Repozitář je veřejný. GitHub nevydá OIDC token workflow z PR z forku, takže cizí PR se k účtu nedostane.
# Token ale dostane každý workflow v tomto repozitáři, i z vedlejší větve, kterou kdokoli s právem zápisu
# upraví. Proto účet nejde použít podle repozitáře, jen z jobu v prostředí production nebo preview. Obě
# prostředí na GitHubu vyžadují schválení (production navíc jen z větve main) a admini je nepřeskočí.
# Hosting nemá oprávnění po kanálech, proto náhled i live sdílí jeden účet a oba hlídá schválení.
locals {
  deploy_environments = ["production", "preview"]
}

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
    "attribute.environment"         = "assertion.environment"
  }

  # Číselná ID místo jména: po přejmenování nebo převodu repozitáře nemůže stejné jméno získat jiný repozitář.
  # Token bez prostředí (job bez `environment:`) nemá claim environment, podmínka selže a token se odmítne.
  attribute_condition = "assertion.repository_id == '${var.github_repository_id}' && assertion.repository_owner_id == '${var.github_repository_owner_id}' && assertion.environment in ${jsonencode(local.deploy_environments)}"

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
  for_each           = toset(local.deploy_environments)
  service_account_id = google_service_account.hosting_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.environment/${each.key}"
}

# Jen Hosting. Fáze 2 (přepis /api/** na Cloud Run) přidá roles/run.viewer.
resource "google_project_iam_member" "hosting_deployer_hosting_admin" {
  project = var.project_id
  role    = "roles/firebasehosting.admin"
  member  = "serviceAccount:${google_service_account.hosting_deployer.email}"
}

# firebase-tools před nasazením ověřuje, že je Hosting API zapnuté (serviceusage.services.get), a bez
# toho skončí na 403. Role jen ke čtení; API zapínat nemůže.
resource "google_project_iam_member" "hosting_deployer_serviceusage_viewer" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageViewer"
  member  = "serviceAccount:${google_service_account.hosting_deployer.email}"
}
