# user_project_override + billing_project: Firebase Management API a Billing Budgets API při přihlášení
# uživatelem (gcloud auth application-default login) vyžadují kvótový projekt. Bez toho apply spadne
# na „API requires a quota project“.
provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}
