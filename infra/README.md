# Infrastruktura na GCP (fáze 1)

Terraform pro veřejnou kalkulačku na Firebase Hosting.
Všechno v GCP se zakládá a mění jen přes Terraform. `gcloud` jen na čtení a na jednorázový bucket pro stav.

| Soubor | Co zakládá |
|---|---|
| `envs/prod/apis.tf` | zapnutá API |
| `envs/prod/firebase.tf` | Firebase na projektu, Hosting site `maira-creative-scaler`, doména `creativescaler.mairateam.com` |
| `envs/prod/deploy_identity.tf` | Workload Identity Federation pro GitHub Actions a účet `hosting-deployer` jen s rolemi Firebase Hosting Admin a Service Usage Viewer |
| `envs/prod/storage.tf` | privátní bucket pro budoucí export poptávek (osobní údaje) a bucket s ukázkami pro build, audit logy čtení |
| `envs/prod/budget.tf` | rozpočtový alert (jen s vyplněným fakturačním účtem) |

Fáze 1 má záměrně jen prod projekt: je to statická stránka bez dat. Před fází 2 (Cloud Run, Firestore,
osobní údaje) se dev projekt zváží znovu. Náhledy z PR jdou na preview channels ve stejném projektu.

## Projekt z Tectury

Prod projekt zakládá interní služba Tectura (project factory nad Cloud Foundation Fabric FAST).
Ověřeno 18. 11. 2026 při prvním apply:

- **Tectura spravuje** projekt, jeho štítky, fakturační účet (sdílený), roli Owner, service agenty a vlastní
  sadu API (BigQuery, Vertex AI, Cloud Run a další). Výchozí síť `default` maže. Na nic z toho tento
  Terraform nesahá.
- **Tento Terraform spravuje** všechno z tabulky výše. Role přidává jen aditivně (na projektu, na bucketu
  a na účtu), takže se s Tecturou nepřetahuje. Kdyby Tectura začala spravovat role na projektu
  autoritativně, musí vynechat `roles/firebasehosting.admin`, `roles/serviceusage.serviceUsageViewer`
  a audit logy `storage.googleapis.com`.
  Jinak je při svém dalším apply smaže.
- **Org policies** platné pro projekt nic z fáze 1 neblokují: WIF, lokace, CMEK i API jsou povolené.
  Kontrola: `gcloud org-policies describe <constraint> --project=<PROJECT_ID> --effective`.
- **Service Usage API** Tectura nezapíná. Zapíná ji `google_project_service.serviceusage` přes provider
  `google.bootstrap` (viz [apis.tf](envs/prod/apis.tf)).
- **Rozpočet:** fakturační účet je sdílený účet Tectury a vlastník projektu k němu přístup nemá. Alert
  proto zakládá Tectura a `billing_account_id` v `terraform.tfvars` zůstává prázdné.
- **Výchozí Hosting site** `<PROJECT_ID>.web.app` založil Firebase sám. Je prázdná a nepoužívá se.
  Příkazy `firebase hosting:*` ji berou jako výchozí, proto u nich zadávejte `--site maira-creative-scaler`.

## Postup po založení projektu

Potřebujete `gcloud`, Terraform 1.9 nebo novější a roli Owner na projektu. Příkazy jsou pro PowerShell
z kořene repozitáře.

**1. Projekt** (žádost na Tecturu): jeden prod projekt, region `europe-west1`. Firebase ani další API
zapínat nemusí, udělá to Terraform.

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
- **„Service Usage API has not been used in project…“**: API se po zapnutí chvíli propisuje. Počkejte
  dvě minuty a apply spusťte znovu.
- **409 u `google_firebase_hosting_site`**: ID site už má někdo jiný. Zvolte jiné `hosting_site_id`
  v `terraform.tfvars` a stejné změňte v `"site"` ve [firebase.json](../firebase.json).
- **409 u `google_firebase_project`**: Firebase už na projektu je. Importujte ho:
  `terraform import google_firebase_project.this projects/<PROJECT_ID>`.
- **403 u `google_firebase_project`**: účet ještě nepřijal podmínky Firebase. Otevřete jednou
  console.firebase.google.com, přijměte je a apply zopakujte.

**6. Ochrana produkce na GitHubu** (Settings → Environments → New environment `production`).
Založte ji dřív než proměnné v kroku 7: chybějící prostředí si workflow založí sám, a to bez schválení.
- Required reviewers: aspoň jeden člověk z týmu.
- Deployment branches: jen `main`.

Repozitář je veřejný, proto ještě Settings → Actions → General → „Require approval for all outside
collaborators“, aby workflow z cizích PR nespouštěl nikdo bez schválení.

**7. Proměnné pro GitHub Actions** (nejsou tajné, proto Variables, ne Secrets):

```powershell
$vars = terraform output -json github_variables | ConvertFrom-Json
$vars.PSObject.Properties | ForEach-Object { gh variable set $_.Name --body $_.Value --repo mairateam/creative-scaler }
```

Workflow [deploy.yml](../.github/workflows/deploy.yml) se tím zapne. Do té doby se jeho joby přeskakují.

**8. Ukázky a nastavení**

```powershell
# ukázky AI kreativ (videa, obrázky): build si je při nasazení stáhne
gcloud storage rsync <složka s ukázkami> gs://<PROJECT_ID>-build-media/media
```

V [config/site.json](../config/site.json) se na ně odkazuje jako `/media/<soubor>`. Soubor smí obsahovat
jen veřejné hodnoty (build jiné klíče odmítne). Ceník, pravidla i ukázky se mění přes PR.

Poptávky (osobní údaje) patří jen do bucketu `-leads-export`, nikdy do gitu ani na web. Z Railway
žádné nebyly (vypnutý 18. 11. 2026), bucket je připravený pro fázi 2.

**9. DNS pro správce** (doména `mairateam.com` je na Cloudflare):

```powershell
terraform output custom_domain_dns_records
terraform output custom_domain_cert_dns_records
```

Pošlete správci DNS oba výpisy a k nim:
- záznamy pro `creativescaler` nastavit jako **DNS only** (šedý mráček), ne přes proxy Cloudflare,
- záznam `_acme-challenge` dovolí vydat certifikát ještě před přepnutím provozu.

Stav k 19. 11. 2026: oba záznamy jsou na Cloudflare přidané; `mairateam.com` nemá záznamy CAA
(certifikát od Googlu nic neblokuje). Pokud výpis zůstane prázdný, načtěte stav znovu:
`terraform apply -refresh-only`. Průběh: `terraform output custom_domain_state`; hotovo je, když
`ownership`, `host` i `cert` končí na `_ACTIVE`.

## Když nasazení z CI selže na oprávnění

Účet `hosting-deployer` má jen `roles/firebasehosting.admin` a `roles/serviceusage.serviceUsageViewer`
(firebase-tools si před nasazením ověřuje, že je Hosting API zapnuté). Pokud nasazení skončí na chybějícím
oprávnění, doplňte roli v `deploy_identity.tf` a pošlete ji přes PR. Ručně v konzoli nic nepřidávejte.
