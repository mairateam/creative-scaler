# Hodnoty pro GitHub (Settings → Secrets and variables → Actions → Variables), viz infra/README.md.
output "github_variables" {
  description = "Proměnné repozitáře, které čte workflow deploy.yml."
  value = {
    GCP_PROJECT_ID     = var.project_id
    GCP_WIF_PROVIDER   = google_iam_workload_identity_pool_provider.github.name
    GCP_DEPLOY_SA      = google_service_account.hosting_deployer.email
    BUILD_MEDIA_BUCKET = google_storage_bucket.build_media.name
  }
}

output "hosting_url" {
  description = "Výchozí adresa webu (funguje hned po prvním nasazení, bez DNS)."
  value       = google_firebase_hosting_site.public.default_url
}

output "leads_export_bucket" {
  description = "Privátní bucket pro export leads.json z Railway."
  value       = google_storage_bucket.leads_export.name
}

# Záznamy pro správce DNS. Po apply mohou být chvíli prázdné; pak `terraform apply -refresh-only`.
output "custom_domain_dns_records" {
  description = "DNS záznamy, které Firebase vyžaduje pro vlastní doménu (vlastnictví a provoz)."
  value = flatten([
    for update in try(google_firebase_hosting_custom_domain.public[0].required_dns_updates, []) : [
      for desired in update.desired : [
        for record in desired.records : {
          name   = record.domain_name
          type   = record.type
          value  = record.rdata
          action = record.required_action
        }
      ]
    ]
  ])
}

# Záznam _acme-challenge dovolí vydat certifikát ještě před přepnutím provozu na Firebase.
output "custom_domain_cert_dns_records" {
  description = "DNS záznamy pro ověření certifikátu (ACME)."
  value = flatten([
    for cert in try(google_firebase_hosting_custom_domain.public[0].cert, []) : [
      for verification in cert.verification : [
        for dns in verification.dns : [
          for desired in dns.desired : [
            for record in desired.records : {
              name   = record.domain_name
              type   = record.type
              value  = record.rdata
              action = record.required_action
            }
          ]
        ]
      ]
    ]
  ])
}

output "custom_domain_state" {
  description = "Stav vlastní domény: vlastnictví, provoz a certifikát."
  value = try({
    ownership = google_firebase_hosting_custom_domain.public[0].ownership_state
    host      = google_firebase_hosting_custom_domain.public[0].host_state
    cert      = google_firebase_hosting_custom_domain.public[0].cert[0].state
  }, null)
}
