# Service Usage API zapíná všechna ostatní API. Na projektu z Tectury zapnutá není a hlavní provider
# účtuje každé volání na tento projekt (user_project_override), takže by ji sám zapnout neuměl.
# Proto ji zapíná provider google.bootstrap, který volání na projekt neúčtuje.
resource "google_project_service" "serviceusage" {
  provider                   = google.bootstrap
  project                    = var.project_id
  service                    = "serviceusage.googleapis.com"
  disable_dependent_services = false
  disable_on_destroy         = false
}

# Některá z těchto API zapnula už Tectura (storage, iam, …). Terraform je spravuje taky; disable_on_destroy
# = false, takže je nikdy nevypne a s Tecturou se nepřetahuje.
locals {
  services = toset([
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "storage.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "monitoring.googleapis.com",
    "billingbudgets.googleapis.com",
  ])
}

resource "google_project_service" "enabled" {
  for_each                   = local.services
  project                    = var.project_id
  service                    = each.key
  disable_dependent_services = false
  disable_on_destroy         = false

  depends_on = [google_project_service.serviceusage]
}
