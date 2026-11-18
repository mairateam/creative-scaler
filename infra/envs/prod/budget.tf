# Rozpočtový alert. Vytvoří se jen s vyplněným billing_account_id.
# Upozornění dostanou admini fakturačního účtu, a když je vyplněný budget_alert_email, i tento e-mail.

data "google_project" "this" {
  project_id = var.project_id
}

resource "google_monitoring_notification_channel" "budget_email" {
  count        = var.billing_account_id != "" && var.budget_alert_email != "" ? 1 : 0
  project      = var.project_id
  display_name = "Creative Scaler: rozpočet"
  type         = "email"
  labels = {
    email_address = var.budget_alert_email
  }
  depends_on = [google_project_service.enabled]
}

resource "google_billing_budget" "monthly" {
  count           = var.billing_account_id == "" ? 0 : 1
  billing_account = var.billing_account_id
  display_name    = "creative-scaler (prod) měsíčně"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  # bez currency_code se použije měna fakturačního účtu
  amount {
    specified_amount {
      units = tostring(var.budget_monthly_amount)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  all_updates_rule {
    monitoring_notification_channels = google_monitoring_notification_channel.budget_email[*].id
    disable_default_iam_recipients   = false
  }

  depends_on = [google_project_service.enabled]
}
