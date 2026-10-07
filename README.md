# meetit.live – generator plakatów

Statyczna strona (HTML + JS + Canvas, bez backendu i bez kroku budowania) do tworzenia plakatów i banerów spotkań meetit.live.

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
| `render.js` | renderer szablonów (współrzędne projektowe: A4 990×1400, baner 1400×735) |
| `fonts.css`, `fonts/` | Lato hostowane lokalnie (z polskimi znakami) |
| `vendor/` | `qrcode-generator` (kody QR), `jsPDF` (eksport PDF) |
| `assets/` | oficjalne logo WMiI (pakiet PL): `wmii-poziom-podstawowe.png` na jasne tło, `wmii-poziom-negatyw.png` na ciemne |

## Szablony

- **Klasyczny / Ciemny / Blokowy** – odwzorowanie dotychczasowych plakatów z `ori/`.
- **Nowoczesny / Duotone / Minimalny** – nowe propozycje.

Nowy szablon dodaje się jako funkcję `(ctx, R)` w `render.js` i wpis w obiekcie `TEMPLATES`.

## Eksport

- A4: 2481×3508 px (300 dpi), opcja 2× = 600 dpi; PDF w formacie A4.
- Baner: 1200×630 px (np. Facebook / wydarzenia), opcja 2×.
- Nazwy plików jak w archiwum: `DDMMRR` + `P` (plakat), `L` (A4 poziom), `Z` (baner).

Projekt (tekst, kadry i zdjęcie) zapisuje się automatycznie w przeglądarce. Można go też zapisać i wczytać jako plik JSON.
# meetit
