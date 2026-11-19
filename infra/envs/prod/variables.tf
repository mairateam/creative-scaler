variable "project_id" {
  description = "ID prod projektu v GCP (fáze 1 má záměrně jen prod, viz infra/README.md)."
  type        = string
}

variable "region" {
  description = "Region pro buckety a další regionální zdroje."
  type        = string
  default     = "europe-west1"
}

variable "hosting_site_id" {
  description = "ID Hosting site (adresa <id>.web.app). Musí být globálně unikátní a shodné s \"site\" ve firebase.json."
  type        = string
  default     = "maira-creative-scaler"
}

variable "custom_domain" {
  description = "Vlastní doména pro Hosting. Prázdný řetězec doménu nepřidá."
  type        = string
  default     = "creativescaler.mairateam.com"
}

variable "github_repository" {
  description = "Repozitář ve tvaru owner/repo. Jen pro popisky; přístup se řídí podle číselných ID níže."
  type        = string
  default     = "mairateam/creative-scaler"
}

# Číselná ID se při přejmenování ani převodu repozitáře nemění, takže přístup nepřejde na cizí repozitář
# se stejným jménem. Ověření: gh api repos/mairateam/creative-scaler --jq '.id, .owner.id'
variable "github_repository_id" {
  description = "Číselné ID GitHub repozitáře, kterému WIF dovolí nasazovat."
  type        = string
  default     = "1393800874"
}

variable "github_repository_owner_id" {
  description = "Číselné ID vlastníka repozitáře (organizace mairateam)."
  type        = string
  default     = "267063754"
}

variable "billing_account_id" {
  description = "ID fakturačního účtu (XXXXXX-XXXXXX-XXXXXX) pro rozpočtový alert. Prázdné = alert se nevytvoří. Kdo spouští apply, potřebuje na účtu roli Billing Account Costs Manager."
  type        = string
  default     = ""
}

variable "budget_monthly_amount" {
  description = "Měsíční rozpočet projektu v měně fakturačního účtu. Fáze 1 (statický web) by měla stát řádově jednotky."
  type        = number
  default     = 20
}

variable "budget_alert_email" {
  description = "E-mail pro rozpočtové alerty navíc k adminům fakturačního účtu. Zadávejte v terraform.tfvars (mimo git), ne v kódu."
  type        = string
  default     = ""
}
