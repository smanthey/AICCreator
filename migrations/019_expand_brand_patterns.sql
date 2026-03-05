-- Migration 019: Expand brand detection — backfill all existing claw.files rows
-- with newly discovered brands from path analysis.
--
-- New brands found via DB path audit (Oct 2024):
--   Apps portfolio:  gethipd, slangboard, face_off, cryptocoin, rent_check, shortcut_app
--   Design brands:   trapcans, glo, glowtray, pastiesgang, truefronto, famous, rarewoods
--                    thenny, chefschoice, picnic, draco, sweet_giggles, crass_wipes
--                    killacam, lit_stick, treeats, luxup, cannasort, zutd
--                    designer_gummies, sweet_stache, day_dreamers, jetlife, bootleg
--                    sickwidit, onac, bcp_caps, ecostylegel, thcvarin, norcalfarms
--                    mapsac, ichiban_farms, cbd_revamp, labs, astrokids
--   Photography:     at_photography, candy_school, dd_hemp, astrokids
--   Fix:             smat pattern was too narrow (required "smat design"), now catches /smat/

-- Single-pass UPDATE using CASE — most specific patterns first to avoid false positives.
-- Only updates rows where brand IS NULL (won't overwrite existing brand values).

UPDATE files
SET brand = CASE
  -- ── Apps Portfolio ──────────────────────────────────────────────────────────
  -- gethipd: large social-app project (~15k files across both machines)
  WHEN path ~* '/gethipd/'                                    THEN 'gethipd'

  -- slangboard: messaging/slang social app
  WHEN path ~* '/slangboard/'                                 THEN 'slangboard'
  WHEN path ~* '/1\.\s*slangboard/'                           THEN 'slangboard'

  -- sticker packs app
  WHEN path ~* '/sticker.?packs?/'                            THEN 'sticker_packs'
  WHEN path ~* '/3\.\s*sticker/'                              THEN 'sticker_packs'

  -- social dashboard app (brands/apps/4. social dashboard)
  WHEN path ~* '/social.?dashboard/'                          THEN 'social_dashboard'
  WHEN path ~* '/4\.\s*social/'                               THEN 'social_dashboard'

  -- face off app
  WHEN path ~* '/face.?off/'                                  THEN 'face_off'
  WHEN path ~* '/6\.\s*face/'                                 THEN 'face_off'

  -- cryptocoin app
  WHEN path ~* '/cryptocoin/'                                 THEN 'cryptocoin'
  WHEN path ~* '/2\.\s*crypto/'                               THEN 'cryptocoin'

  -- rent check app
  WHEN path ~* '/rent.?check/'                                THEN 'rent_check'
  WHEN path ~* '/8\.\s*rent/'                                 THEN 'rent_check'

  -- shortcut app (7. shortcut)
  WHEN path ~* '/7\.\s*shortcut/'                             THEN 'shortcut_app'

  -- mobile ads dashboards (5. mobile ads)
  WHEN path ~* '/mobile.?ads/'                                THEN 'social_dashboard'
  WHEN path ~* '/5\.\s*mobile/'                               THEN 'social_dashboard'

  -- ── Design / Brand Portfolio ─────────────────────────────────────────────
  -- trapcans: cannabis/trap aesthetic brand
  WHEN path ~* '/trapcans/'                                   THEN 'trapcans'

  -- glo: must be before glowtray check
  WHEN path ~* '/glo/' AND path !~* '/glowtray/'              THEN 'glo'

  -- glowtray
  WHEN path ~* '/glowtray/'                                   THEN 'glowtray'

  -- pastiesgang / pasties gang
  WHEN path ~* '/pastiesgang/' OR path ~* '/pasties.?gang/'   THEN 'pastiesgang'

  -- truefronto
  WHEN path ~* '/truefronto/'                                 THEN 'truefronto'

  -- famous
  WHEN path ~* '/famous/'                                     THEN 'famous'

  -- rarewoods
  WHEN path ~* '/rarewoods/'                                  THEN 'rarewoods'

  -- thenny
  WHEN path ~* '/thenny/'                                     THEN 'thenny'

  -- chefs choice
  WHEN path ~* '/chefs?.?choice/'                             THEN 'chefschoice'

  -- picnic brand (avoid matching generic "picnic" dirs)
  WHEN path ~* '/brands/picnic/'                              THEN 'picnic'
  WHEN path ~* '/Desktop.*Tatsheen.*picnic/'                  THEN 'picnic'

  -- draco brand
  WHEN path ~* '/brands/draco/'                               THEN 'draco'
  WHEN path ~* '/Desktop.*Tatsheen.*draco/'                   THEN 'draco'

  -- sweet & giggles
  WHEN path ~* '/sweet.?(&|and).?giggles/'                    THEN 'sweet_giggles'

  -- crass wipes
  WHEN path ~* '/crass.?wipes/'                               THEN 'crass_wipes'

  -- killacam
  WHEN path ~* '/killacam/'                                   THEN 'killacam'

  -- lit stick
  WHEN path ~* '/lit.?stick/'                                 THEN 'lit_stick'

  -- TreEats / tree eats
  WHEN path ~* '/treeats/' OR path ~* '/tre.?eats/'           THEN 'treeats'

  -- luxup
  WHEN path ~* '/luxup/'                                      THEN 'luxup'

  -- cannasort
  WHEN path ~* '/cannasort/'                                  THEN 'cannasort'

  -- ZUTD
  WHEN path ~* '/zutd/'                                       THEN 'zutd'

  -- designer gummies
  WHEN path ~* '/designer.?gummies/'                          THEN 'designer_gummies'

  -- sweet stache
  WHEN path ~* '/sweet.?stache/'                              THEN 'sweet_stache'

  -- day dreamers / liquid dreams
  WHEN path ~* '/day.?dreamers/' OR path ~* '/liquid.?dreams/' THEN 'day_dreamers'

  -- jetlife
  WHEN path ~* '/jetlife/'                                    THEN 'jetlife'

  -- bootleg
  WHEN path ~* '/brands/bootleg/'                             THEN 'bootleg'

  -- sickwidit
  WHEN path ~* '/sickwidit/'                                  THEN 'sickwidit'

  -- onac
  WHEN path ~* '/onac/'                                       THEN 'onac'

  -- bcp caps
  WHEN path ~* '/bcp.?caps/'                                  THEN 'bcp_caps'

  -- ecostyle gel / ECOSTYLERGEL
  WHEN path ~* '/ecostyle/'                                   THEN 'ecostylegel'

  -- thcvarin
  WHEN path ~* '/thcvarin/'                                   THEN 'thcvarin'

  -- norcal farms
  WHEN path ~* '/norcalfarms/' OR path ~* '/norcal.?farms/'   THEN 'norcalfarms'

  -- mapsac
  WHEN path ~* '/mapsac/'                                     THEN 'mapsac'

  -- ichiban farms
  WHEN path ~* '/ichiban/'                                    THEN 'ichiban_farms'

  -- cbd revamp
  WHEN path ~* '/cbd.?revamp/'                                THEN 'cbd_revamp'

  -- labs (must be path-specific to avoid false positives)
  WHEN path ~* '/brands/labs/'                                THEN 'labs'
  WHEN path ~* '/Desktop.*Tatsheen.*labs/'                    THEN 'labs'

  -- kens tko
  WHEN path ~* '/kens?.?tko/'                                 THEN 'kens_tko'

  -- ipod store
  WHEN path ~* '/ipod.?store/'                                THEN 'ipod_store'

  -- ── Photography / Shoots ──────────────────────────────────────────────────
  -- AT Photography
  WHEN path ~* '/at.?photo/' OR path ~* '/at photography/'    THEN 'at_photography'

  -- ASTROkids Clothing
  WHEN path ~* '/astrokids/'                                  THEN 'astrokids'

  -- candy school
  WHEN path ~* '/candy.?school/'                              THEN 'candy_school'

  -- DD HEMP BARS
  WHEN path ~* '/dd.?hemp/'                                   THEN 'dd_hemp'

  -- Heaven sins
  WHEN path ~* '/heaven.?sins/'                               THEN 'heaven_sins'

  -- Ecoco Hairstyle
  WHEN path ~* '/ecoco/'                                      THEN 'ecoco'

  -- Talent Agency
  WHEN path ~* '/talent.?agency/'                             THEN 'talent_agency'

  -- ── Fix: smat pattern was too narrow ─────────────────────────────────────
  -- Previous pattern only matched "smat design" / "SMAt designs".
  -- Now also catches /Documents/smat/, /Desktop/smat/, etc.
  WHEN path ~* '/smat/'                                       THEN 'smat'
  WHEN filename ~* '^smat[_\-\s]'                             THEN 'smat'

  -- ── Catch-all: branded by top-level NAS folder name ─────────────────────
  -- For nas_primary files, use the first Storage subfolder as brand
  -- (already mostly handled by index-nas-storage.js; this catches edge cases)
  ELSE NULL
END
WHERE brand IS NULL
  AND (
    path ~* '/gethipd/'         OR path ~* '/slangboard/'     OR
    path ~* '/sticker.?pack'    OR path ~* '/social.?dash'    OR
    path ~* '/face.?off/'       OR path ~* '/cryptocoin/'     OR
    path ~* '/rent.?check/'     OR path ~* '/trapcans/'       OR
    path ~* '/glowtray/'        OR path ~* '/pastiesgang/'    OR
    path ~* '/pasties.?gang/'   OR path ~* '/truefronto/'     OR
    path ~* '/famous/'          OR path ~* '/rarewoods/'      OR
    path ~* '/thenny/'          OR path ~* '/chefs?.?choice/' OR
    path ~* '/sweet.?giggles/'  OR path ~* '/crass.?wipes/'   OR
    path ~* '/killacam/'        OR path ~* '/lit.?stick/'     OR
    path ~* '/treeats/'         OR path ~* '/tre.?eats/'      OR
    path ~* '/luxup/'           OR path ~* '/cannasort/'      OR
    path ~* '/zutd/'            OR path ~* '/designer.?gum'   OR
    path ~* '/sweet.?stache/'   OR path ~* '/day.?dreamers/'  OR
    path ~* '/liquid.?dreams/'  OR path ~* '/jetlife/'        OR
    path ~* '/brands/bootleg/'  OR path ~* '/sickwidit/'      OR
    path ~* '/onac/'            OR path ~* '/bcp.?caps/'      OR
    path ~* '/ecostyle/'        OR path ~* '/thcvarin/'       OR
    path ~* '/norcal'           OR path ~* '/mapsac/'         OR
    path ~* '/ichiban/'         OR path ~* '/cbd.?revamp/'    OR
    path ~* '/brands/labs/'     OR path ~* '/kens?.?tko/'     OR
    path ~* '/ipod.?store/'     OR path ~* '/at.?photo'       OR
    path ~* '/astrokids/'       OR path ~* '/candy.?school/'  OR
    path ~* '/dd.?hemp/'        OR path ~* '/heaven.?sins/'   OR
    path ~* '/ecoco/'           OR path ~* '/talent.?agency/' OR
    path ~* '/smat/'            OR
    (path ~* '/glo/' AND path !~* '/glowtray/') OR
    path ~* '/4\.\s*social'     OR path ~* '/1\.\s*slang'     OR
    path ~* '/3\.\s*sticker'    OR path ~* '/6\.\s*face'      OR
    path ~* '/2\.\s*crypto'     OR path ~* '/8\.\s*rent'      OR
    path ~* '/7\.\s*short'      OR path ~* '/5\.\s*mobile'    OR
    path ~* '/brands/draco/'    OR path ~* '/brands/picnic/'  OR
    path ~* '/Desktop.*Tatsheen.*picnic/' OR
    path ~* '/Desktop.*Tatsheen.*draco/'  OR
    path ~* '/Desktop.*Tatsheen.*labs/'
  );
