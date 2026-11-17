# Stav je v GCS bucketu v prod projektu. Bucket vzniká mimo Terraform (scripts/infra/bootstrap-state-bucket.ps1),
# protože Terraform potřebuje bucket dřív, než může cokoli spravovat. Jméno se doplní při init:
#
#   terraform init -backend-config="bucket=<PROJECT_ID>-tfstate"
terraform {
  backend "gcs" {
    prefix = "creative-scaler/prod"
  }
}
