# meetit.live – generator plakatów

Statyczna strona (HTML + JS + Canvas, bez backendu i bez kroku budowania) do tworzenia plakatów i banerów spotkań meetit.live
oraz seminariów wydziałowych WMiI.

## Typy generatora (zakładki)

| Zakładka | Adres | Opis |
|---|---|---|
| **meetit.live** | `#meetit` | jeden tytuł, prelegenci, jedno zdjęcie |
| **meetit.live · 2 prelegentów** | `#dwoch-prelegentow` | jeden tytuł, dwóch prelegentów – każdy z własnym zdjęciem, nazwiskiem i afiliacją |
| **Seminarium Wydziałowe** | `#seminarium` | plakat kolokwium wydziałowego (gradient, godło WMiI, tytuł szeryfowy, zaproszenie) |

Każda zakładka ma osobny stan projektu i osobne zdjęcia (zapamiętywane w przeglądarce).

## Uruchomienie lokalne

```sh
python3 -m http.server 8000   # w katalogu webgen
```

i otwórz http://localhost:8000.

## Wdrożenie na Vercel

- **CLI:** `npx vercel` w katalogu `webgen` (framework: *Other*, bez komendy build, katalog wyjściowy: `.`).
- **Z repozytorium:** ustaw *Root Directory* na `webgen`, *Framework Preset* na *Other*, build command pusty.

## Struktura

| Plik | Rola |
|---|---|
| `index.html`, `style.css` | interfejs |
| `app.js` | formularz, podgląd, kadrowanie zdjęcia, eksport PNG/JPG/PDF, zapis projektu |
| `render.js` | renderer szablonów (współrzędne projektowe: pion 990×1400 – wspólne dla A3 i A4, baner 1400×735) |
| `fonts.css`, `fonts/` | Lato hostowane lokalnie (z polskimi znakami); dla seminarium: Old Standard TT, Caveat, Roboto Condensed (OFL, fontsource) |
| `vendor/` | `qrcode-generator` (kody QR), `jsPDF` (eksport PDF) |
| `assets/` | oficjalne logo WMiI (pakiet PL): `wmii-poziom-podstawowe.png` na jasne tło, `wmii-poziom-negatyw.png` na ciemne |

## Szablony

- **Klasyczny / Ciemny / Blokowy** – odwzorowanie dotychczasowych plakatów z `ori/`.
- **Nowoczesny / Duotone / Minimalny / Koło / Typograficzny / Ramka / Polaroid / Gradient** – nowe propozycje.

Nowe szablony mają regulowany *kolor główny* i *kolor wyróżnienia*; Duotone ma własne kolory cieni i świateł,
Gradient – siłę zabarwienia zdjęcia, Ciemny – kolor przyciemnienia. Zdjęcie można skorygować (jasność, kontrast, nasycenie).

- **2 prelegentów:** Klasyczny, Nowoczesny, Koło, Duotone – każde zdjęcie kadruje się osobno (przeciąganie i kółko myszy na danym zdjęciu).
- **Seminarium:** Kolokwium – odwzorowanie plakatu kolokwium WMiI (godło wektorowe wyciągnięte z oryginalnego PDF).

Nowy szablon dodaje się jako funkcję `(ctx, R)` w `render.js` i wpis w obiekcie `TEMPLATES`
(`mode` – zakładka: `single` / `duo2` / `seminar`; `uses` – lista kontrolek wyglądu, które panel ma pokazać dla tego szablonu).
Zdjęcia rysuje `drawPhoto(ctx, R, rect, duotone, slot)` – `slot` 0 lub 1 to numer prelegenta.

## Eksport

- A3 (domyślnie): 3508×4961 px (300 dpi), A4: 2481×3508 px; opcja 2× = 600 dpi; PDF w wybranym formacie.
- Baner: 1200×630 px (np. Facebook / wydarzenia), opcja 2×.
- Nazwy plików jak w archiwum: `DDMMRR` + `P` (plakat), `L` (poziom), `Z` (baner); seminarium: `kolokwium-DDMMRR…`.

Projekt (tekst, kadry i zdjęcie) zapisuje się automatycznie w przeglądarce. Można go też zapisać i wczytać jako plik JSON.
# meetit
