# Dva privátní buckety. Žádný není veřejný; Firebase Hosting je nepotřebuje.

# Export poptávek: osobní údaje. Z Railway žádné poptávky nebyly; bucket je připravený pro fázi 2
# (export a import do Firestore). Přístup jen přes role na projektu (Owner/Editor), nic dalšího se nepřidává.
resource "google_storage_bucket" "leads_export" {
  project                     = var.project_id
  name                        = "${var.project_id}-leads-export"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  labels = {
    app  = "creative-scaler"
    data = "personal"
  }

  depends_on = [google_project_service.enabled]

  lifecycle {
    prevent_destroy = true
  }
}

# Ukázky AI kreativ (videa, obrázky) pro statický build. Do gitu nepatří (repozitář je veřejný),
# CI je při nasazení stáhne do media/ a build zkopíruje jen ty, na které odkazuje config/site.json.
resource "google_storage_bucket" "build_media" {
  project                     = var.project_id
  name                        = "${var.project_id}-build-media"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 30
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    app  = "creative-scaler"
    data = "public-media"
  }

  depends_on = [google_project_service.enabled]
}

# CI čte ukázky (gcloud storage rsync potřebuje objects.list + objects.get).
resource "google_storage_bucket_iam_member" "build_media_deployer_read" {
  bucket = google_storage_bucket.build_media.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.hosting_deployer.email}"
}

# Záznam o tom, kdo četl nebo měnil objekty (hlavně export poptávek s osobními údaji).
# Pozor: zdroj je autoritativní pro audit logy služby storage.googleapis.com v celém projektu.
resource "google_project_iam_audit_config" "storage" {
  project = var.project_id
  service = "storage.googleapis.com"

  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
}
