locals {
  services = toset([
    "serviceusage.googleapis.com",
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
}
