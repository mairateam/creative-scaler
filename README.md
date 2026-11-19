# Creative Scaler

Kalkulačka, která klientovi ukáže, kolik kreativ na Meta Ads opravdu potřebuje, kolik to bude stát a co se stane bez nových kreativ. Na konci je výzva „Chci kreativy“.

**Na webu** běží veřejná kalkulačka jako statická stránka na Firebase Hosting: https://creativescaler.mairateam.com (viz [Nasazení](#nasazení-firebase-hosting)). Admin ani poptávkový formulář tam nejsou; tlačítka „Chci kreativy“ vedou na web MAIRA.

**Express aplikace** v tomto repozitáři má i admin a formulář. Zatím běží jen lokálně, nasadit se má ve fázi 2. Má dvě části:

| Část | Adresa | Pro koho | Co tam je |
|---|---|---|---|
| **Veřejná** | `/` | klienti | kalkulačka, náklady na AI produkci, ukázky AI kreativ, graf únavy kreativ, měsíční plán, poptávkový formulář, jazyky CZ/SK/EN |
| **Admin** | `/admin` | tým | celá kalkulačka s předpoklady a rozpisem výpočtu, demo účty, generátor názvů kreativ do výroby, odkaz pro klienta, **nastavení** (ceník, pravidla, ukázky) a **poptávky** |

Návod pro kolegy (bez technických detailů) je přímo v aplikaci na adrese **/READ_ME**.

Co se v adminu uloží v Nastavení, veřejná část hned přebere. Interní věci (předpoklady, zadání do výroby, demo účty, poptávky) do veřejné části vůbec nechodí, ani ve zdrojovém kódu stránky.

## Hesla a proměnné (Express aplikace)

- `ADMIN_PASSWORD` – vstup do adminu.
- `PUBLIC_PASSWORD` – vstup do veřejné části. Dokud je nastavené, klient potřebuje heslo.
- `PUBLIC_OPEN` – **až bude kalkulačka pro klienty hotová**, nastavte `PUBLIC_OPEN=true`. Veřejná část se otevře bez hesla (i když je `PUBLIC_PASSWORD` vyplněné).

Když chybí heslo i `PUBLIC_OPEN`, veřejná část zůstane zavřená a pustí jen admina. Nic se tak neotevře omylem.

- `ADMIN_OPEN` – nastavte `true`, aby admin fungoval bez hesla (jen pro demo). Pozor: kdo zná adresu `/admin`, uvidí poptávky i s kontakty a může měnit nastavení.

Admin heslo otevře i veřejnou část. Změna hesla automaticky odhlásí všechny, kdo byli přihlášení starým heslem.

- `DATA_DIR` – složka, kam aplikace ukládá nastavení, poptávky a nahrané ukázky.
- `SLACK_WEBHOOK_URL` – nepovinné: adresa Incoming Webhooku ze Slacku. Každá nová poptávka pak přijde i do zvoleného kanálu.

## Nasazení (Firebase Hosting)

Veřejná kalkulačka běží jako statická stránka na Firebase Hosting v prod projektu na GCP: bez serveru, adminu a poptávkového formuláře. Adresy jsou https://creativescaler.mairateam.com a https://maira-creative-scaler.web.app. Stránka má zatím `noindex`. Infrastruktura a postup jsou v [infra/README.md](infra/README.md).

Dřívější nasazení Express aplikace na Railway je od 18. 11. 2026 vypnuté.

**Nastavení** (ceník, pravidla, ukázky) je v souboru [config/site.json](config/site.json). Změna = PR, po schválení se nasadí. Soubor je veřejný (repozitář i web), proto smí obsahovat jen veřejné hodnoty. Build jiné klíče odmítne a zkontroluje rozsahy stejně jako admin.

**Ukázky** (videa a obrázky) do gitu nepatří. Leží v privátním bucketu `<projekt>-build-media` ve složce `media/`. V `site.json` se na ně odkazuje jako `/media/<soubor>`, stejně jako v Express aplikaci. Při nasazení je CI stáhne a build zkopíruje jen ty, na které nastavení odkazuje.

```bash
npm run build:static     # statická stránka do dist/
npm run check:static     # selže, když by na web šlo něco interního
npm test                 # testy výřezu nastavení, buildu a hlaviček z firebase.json
npm run preview:static   # build + Firebase Hosting emulator na http://127.0.0.1:5050
```

Emulátor na Windows neposílá hlavičky z `firebase.json` (CSP, cache, noindex). Je to chyba v nástroji, ne v nastavení; na Linuxu a ve Firebase fungují a hlídá je `npm test`.

**Nasazení** dělá GitHub Actions ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)):
- PR → náhled na preview channel (platí 7 dní) po schválení v prostředí `preview`; adresa je u nasazení a v souhrnu běhu.
- `main` → produkce po schválení v prostředí `production`.

Účet pro nasazení jde použít jen z jobu v jednom z těchto dvou prostředí, takže bez schválení se nenasadí nic, ani z upraveného workflow na vedlejší větvi. `main` chrání ruleset: změna jen přes PR se zelenými kontrolami CI.

Bezpečnostní chyby hlaste podle [SECURITY.md](SECURITY.md).

Hlavičky (CSP, HSTS, `noindex`, cache) jsou ve [firebase.json](firebase.json). `/api/config` se přepisuje na `/config.json`, takže `public.js` načítá nastavení ze stejné adresy jako z Express serveru.

## Písmo

Web MAIRA používá písmo **PP Neue Corp Compact**. Soubory písma nejsou v repozitáři, protože jde o placené písmo a jeho licenci spravuje MAIRA. Do té doby se zobrazuje velmi podobné **Archivo** ve zúženém řezu. Archivo je přímo v `public/assets/fonts/` (licence OFL), ne z Google Fonts: načítání od Googlu by posílalo IP adresy návštěvníků do USA.

Až MAIRA písmo dodá a licence to dovolí, stačí nahrát tyto dva soubory do `public/assets/fonts/`. Repozitář je veřejný, takže placené písmo do gitu nepatří; musí se do buildu dostat jinak (např. jako ukázky z bucketu).

- `PPNeueCorp-CompactMedium.woff2`
- `PPNeueCorp-CompactUltrabold.woff2`

Aplikace je začne používat sama, bez další úpravy kódu.

## Lokální spuštění

```bash
npm install
npm run dev
```

Otevřete http://localhost:3000 (heslo `demo`) a http://localhost:3000/admin (heslo `admin`).

## Co je zatím demo

- **Demo účty** v adminu jsou vymyšlené. Další krok je načítat spend, CPA, ROAS a počet reklam přímo z Meta účtu klienta.
- **Graf únavy kreativ** je ilustrační křivka (bez obměny +7 % týdně od 3. týdne). Nahradit daty z účtů MAIRA.
- **Ceník** je ukázkový. Na webu se mění v `config/site.json` (`prices` a `pricesAreDemo` na `false`), v Express aplikaci v adminu v Nastavení (volba „Ceny jsou orientační“).
- **Ukázky AI kreativ** zatím chybí. Na web se nahrávají do bucketu a odkazují v `config/site.json` (viz Nasazení), v Express aplikaci v adminu v Nastavení.

## Jak výpočet funguje (verze 0.5)

Podle zpětné vazby týmu (Šimon, Kuba, Filip – Asana, říjen 2026):

1. Počet nových kreativ měsíčně vychází přímo z rozpočtu bez katalogu: přímka mezi kotvami **100 tis. Kč = 10** a **1 mil. Kč = 50** kreativ, zaokrouhleno po 5.
2. **Situace účtu** násobí výsledek: stabilní provoz 1×, růst 1,5×, launch / nový směr 2×.
3. **Malé rozpočty:** pod 100 tis. Kč 1 sada (5 kreativ) měsíčně, pod 50 tis. Kč 1 sada za 2 měsíce.
4. **Nad 50 kreativ** se číslo počítá dál, ale klient vidí štítek „individuální nabídka“.
5. Sada má 5 kreativ: 3 videa s různým hookem a 2 odlišné statiky.
6. Živé kreativy = kreativy v právě běžících testech + vítězové (1 ze sady, ~4 týdny), **minimálně 6**.
7. **Únava kreativ:** bez obměny zdražuje konverze o 7 % týdně od 3. týdne. Doporučený objem tento růst tlumí o 70 %, menší objem úměrně méně. Když klient vyplní dnešní počet kreativ, druhá křivka ukazuje jeho dnešní tempo.
8. **CPA a ROAS** počet kreativ neovlivňují, slouží jen k přepočtu na konverze, tržby a ztrátu z únavy. Trh se už nevybírá. Pravidlo „~50 konverzí týdně na sadu“ je zrušené; pod 10 konverzí na kreativu v testu dostane klient neutrální tip.
8b. **Rozpočet na kreativu** = 30 % spendu ÷ počet nových kreativ (jen informace).
8c. **Tipy místo varování:** rozpočet pod 20 tis. Kč, pod 50 tis. Kč pomalejší rytmus, nad 50 kreativ individuálně, výroba nad 35 % rozpočtu.
9. Veřejná část ukazuje jen cenu AI produkce. Srovnání s klasickou produkcí je jen v adminu.
10. **Ukázky AI kreativ** bere web z bucketu podle `config/site.json`; v Express aplikaci se nahrávají v adminu v Nastavení (do `DATA_DIR/media`). Bez ukázek se sekce neukazuje.

Všechny kotvy, násobky, minimum živých reklam, únava i ceník jdou změnit v `config/site.json` (web) nebo v adminu v Nastavení (Express aplikace).

## Struktura

```
server.js              server, přihlášení, API
store.js               ukládání nastavení a poptávek (JSON v DATA_DIR)
lib/config.js          výchozí nastavení, kontrola hodnot, veřejný výřez (server i statický build)
views/                 stránky: veřejná, admin, přihlášení
public/assets/         veřejné soubory: styly, písmo, sdílený výpočet (core.js), veřejná logika
private/admin.js       logika adminu, posílá se jen přihlášenému adminovi
config/site.json       nastavení statické stránky na Firebase Hosting (jen veřejné hodnoty)
scripts/               statický build, kontrola buildu, bucket pro stav Terraformu
firebase.json          Firebase Hosting: hlavičky, cache, přepis /api/config
infra/                 Terraform pro GCP (fáze 1)
.github/workflows/     CI a nasazení
```
