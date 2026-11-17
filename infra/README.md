# Infrastruktura na GCP (fáze 1)

Terraform pro veřejnou kalkulačku na Firebase Hosting. Plán a rozhodnutí jsou v [TODO.md](../TODO.md).
Všechno v GCP se zakládá a mění jen přes Terraform. `gcloud` jen na čtení a na jednorázový bucket pro stav.

| Soubor | Co zakládá |
|---|---|
| `envs/prod/apis.tf` | zapnutá API |
| `envs/prod/firebase.tf` | Firebase na projektu, Hosting site `maira-creative-scaler`, doména `creativescaler.mairateam.com` |
| `envs/prod/deploy_identity.tf` | Workload Identity Federation pro GitHub Actions a účet `hosting-deployer` jen s rolí Firebase Hosting Admin |
| `envs/prod/storage.tf` | privátní bucket pro export poptávek (osobní údaje) a bucket s ukázkami pro build, audit logy čtení |
| `envs/prod/budget.tf` | rozpočtový alert (jen s vyplněným fakturačním účtem) |

Fáze 1 má jen prod projekt (rozhodnutí 5). Náhledy z PR jdou na preview channels ve stejném projektu.

## Postup po založení projektu

Potřebujete `gcloud`, Terraform 1.9 nebo novější, roli Owner na projektu a pro rozpočet roli
Billing Account Costs Manager na fakturačním účtu. Příkazy jsou pro PowerShell z kořene repozitáře.

**1. Projekt** (žádost na správce GCP): jeden prod projekt, region `europe-west1`, napojený fakturační účet.
Firebase zapínat nemusí, udělá to Terraform.

**2. Přihlášení**

```powershell
gcloud auth login
gcloud auth application-default login
```

**3. Bucket pro stav Terraformu** (jediná věc mimo Terraform, viz skript):

```powershell
pwsh ./scripts/infra/bootstrap-state-bucket.ps1 -ProjectId <PROJECT_ID>
```

**4. Proměnné**: zkopírujte `envs/prod/terraform.tfvars.example` do `envs/prod/terraform.tfvars` a doplňte.
Soubor je v `.gitignore`. Repozitář je veřejný, takže e-maily ani ID fakturačního účtu do gitu nepatří.

**5. Plán a apply**

```powershell
cd infra/envs/prod
terraform init -backend-config="bucket=<PROJECT_ID>-tfstate"
terraform plan -out tfplan
terraform apply tfplan
```

Možné chyby:
- **409 u `google_firebase_hosting_site`**: ID site už má někdo jiný. Zvolte jiné `hosting_site_id`
  v `terraform.tfvars` a stejné změňte v `"site"` ve [firebase.json](../firebase.json).
- **409 u `google_firebase_project`**: Firebase už na projektu je. Importujte ho:
  `terraform import google_firebase_project.this projects/<PROJECT_ID>`.
- **403 u `google_firebase_project`**: účet ještě nepřijal podmínky Firebase. Otevřete jednou
  console.firebase.google.com, přijměte je a apply zopakujte.

**6. Proměnné pro GitHub Actions** (nejsou tajné, proto Variables, ne Secrets):

```powershell
$vars = terraform output -json github_variables | ConvertFrom-Json
$vars.PSObject.Properties | ForEach-Object { gh variable set $_.Name --body $_.Value --repo mairateam/creative-scaler }
```

Workflow [deploy.yml](../.github/workflows/deploy.yml) se tím zapne. Do té doby se jeho joby přeskakují.

**7. Ochrana produkce na GitHubu** (Settings → Environments → New environment `production`):
- Required reviewers: aspoň jeden člověk z týmu.
- Deployment branches: jen `main`.

Repozitář je veřejný, proto ještě Settings → Actions → General → „Require approval for all outside
collaborators“, aby workflow z cizích PR nespouštěl nikdo bez schválení.

**8. Data z Railway** (export volume `/data`, viz TODO.md, sekce 2):

```powershell
# ukázky AI kreativ: build si je při nasazení stáhne
gcloud storage rsync <export>/media gs://<PROJECT_ID>-build-media/media
# poptávky (osobní údaje): jen do privátního bucketu, nikdy do gitu ani na web
gcloud storage cp <export>/leads.json gs://<PROJECT_ID>-leads-export/railway-<YYYY-MM-DD>/leads.json
```

Z exportovaného `config.json` přeneste do [config/site.json](../config/site.json) jen veřejné hodnoty
(build jiné klíče odmítne). Celý `config.json` uložte vedle poptávek do bucketu `-leads-export`;
fáze 2 z něj naplní Firestore.

**9. DNS pro správce** (doména `mairateam.com` je na Cloudflare):

```powershell
terraform output custom_domain_dns_records
terraform output custom_domain_cert_dns_records
```

Pošlete správci DNS oba výpisy a k nim:
- záznamy pro `creativescaler` nastavit jako **DNS only** (šedý mráček), ne přes proxy Cloudflare,
- záznam `_acme-challenge` dovolí vydat certifikát ještě před přepnutím provozu.

Stav k 17. 11. 2026: `mairateam.com` nemá záznamy CAA (certifikát od Googlu nic neblokuje) a subdoména
`creativescaler` zatím neexistuje, takže není co mazat. Pokud výpis zůstane prázdný, načtěte stav znovu:
`terraform apply -refresh-only`. Průběh: `terraform output custom_domain_state`.

## Když nasazení z CI selže na oprávnění

Účet `hosting-deployer` má jen `roles/firebasehosting.admin`. Pokud první nasazení skončí na chybějícím
oprávnění, doplňte roli v `deploy_identity.tf` a pošlete ji přes PR. Ručně v konzoli nic nepřidávejte.
