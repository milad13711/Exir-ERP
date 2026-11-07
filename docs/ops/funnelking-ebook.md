# Funnel King e-book delivery (book-store module)

When an `EBOOK` order is paid, `BookStoreService.finalizeOrderPayment` stores the licence code on the `BookOrder`. It then starts building the buyer's personalised copy in the background: `EbookDeliveryService` spawns `license_stamp.py issue`, which produces a PDF and an EPUB stamped with the buyer's name, masked phone, order number and code.
The buyer receives one signed, expiring link. It appears on the Zarinpal callback page and in the confirmation SMS, and opens a page with both files. Later, the buyer can get fresh links from the funnelking.ir `/library` page (OTP on the purchase phone). Anyone can check a copy at `/verify` with order number, phone and licence code.

Code: `apps/backend-core/src/book-store/ebook-*.ts`, `src/public/public-book-ebook.controller.ts`. The stamping tool itself lives outside the repo in `~/Documents/FunnelKing_build/ebook/` and is deployed as data (below), not built into the image.

## Endpoints (public, `:slug` = tenant slug or public key)
| | |
|---|---|
| `GET  /api/public/book/:slug/ebook/:orderId?e=&s=` | delivery page (HTML, no JS; auto-refreshes while the copy is being built) |
| `GET  /api/public/book/:slug/ebook/:orderId/(pdf\|epub)?e=&s=` | file download; waits up to 45 s for the build, then falls back to the page |
| `POST /api/public/book/:slug/library` `{bookingToken}` | paid e-book orders of the OTP-verified phone, with fresh links |
| `POST /api/public/book/:slug/license/verify` `{orderNo, phone, code}` | `{valid:false}` or `{valid:true, orderNo, holderName, holderPhone, issuedAt}` |

Links: one HMAC token (key derived from `FK_LICENSE_SECRET`) covers both files of one order. Expiry → 410 page pointing to `/library`. Rate limits: `book-license-verify-ip` (30 / 15 min), `book-ebook-download-ip` (40 / hour).

## Server setup checklist (owner, once)
1. **Build with the stamper**: in the server `.env` set `WITH_EBOOK_STAMPER=true`. If PyPI is blocked, also set `PIP_INDEX_URL=<mirror>/simple`. Then `./scripts/deploy.sh backend`. This adds python3 and `pymupdf==1.28.2`, about 80 MB.
2. **Private files** on the host, next to `docker-compose.on-premise.yml`:
   ```
   data/funnelking-ebook/master/soltan-ghif-master.pdf
   data/funnelking-ebook/master/soltan-ghif-master.epub
   data/funnelking-ebook/tool/license_stamp.py
   data/funnelking-ebook/tool/fonts/            (Vazir.ttf, Vazir-Bold.ttf … from ebook/fonts)
   data/funnelking-ebook/issued/                (empty; written by the backend)
   ```
   Copy from `~/Documents/FunnelKing_build/ebook/` with `rsync`. The folder is mounted only into `backend` at `/app/ebook`, so nginx and web never see it. Never put the masters under any web root. Make `issued/` writable by the container user:
   `docker compose -f docker-compose.on-premise.yml exec -u root backend chown -R exir:exir /app/ebook/issued`.
   About 8 MB per buyer: include `data/funnelking-ebook/issued` in disk monitoring. Copies can be deleted at any time and are rebuilt on the next download.
3. **Env** (`.env`, then recreate backend):
   - `FK_LICENSE_SECRET`: a long random string. It must be the same value used for any copies issued by hand. **Never change it**: every printed licence code and every outstanding link depends on it. Keep a copy in the password manager.
   - `FK_EBOOK_TENANT_SLUG`: the book tenant's slug, or its public key `t63724ac4c3f`. Delivery is fail-closed for every other tenant that installs `book-store`.
   - `FK_EBOOK_LINK_TTL_HOURS`: default `72`.
   - `FUNNELKING_PUBLIC_URL=https://funnelking.ir`: used for the `/library` link in the SMS and pages.
   - `PUBLIC_API_URL`: must be internet-reachable, because the download links are built on it.
4. **Migration** `20261031130000_book_order_ebook_delivery`: tenant DBs pick it up through migrate-all-tenants on boot. It adds `licenseCode`, `ebookIssuedAt`, `ebookError` and a `buyerPhone` index. It comes after `20260929120000_add_book_store`, which has also not been applied anywhere yet.
5. **Smoke test** after deploy: run `docker compose … exec backend python3 -c "import pymupdf"`. Then make one sandbox `EBOOK` purchase and check the callback page buttons, the SMS link, `/library` and `/verify`.

## Support
- `book_orders.ebookError` holds the last build failure. Clicking a download button retries the build. A failure from the "licence code mismatch" check means the stamper saw a different `FK_LICENSE_SECRET`.
- To check a code by hand, run `FK_LICENSE_SECRET=… python license_stamp.py verify --phone … --order <orderNo> --code …`. The site's `/verify` page does the same.
- AUDIO orders are still fulfilled by hand: the SMS says the file will be sent.
