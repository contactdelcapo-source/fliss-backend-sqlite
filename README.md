FLISS BACKEND SQLITE (Render)

1) Pousse ces fichiers dans ton repo GitHub (racine).
2) Render va redeployer automatiquement.
3) Test:
   - /health
   - POST /api/login

Admin auto-seed:
  ghassen@thefliss.com / Fqtu548re@

IMPORTANT:
- Ce backend fait une migration automatique si ta table users est ancienne (ajoute agencies si manquant).
- Le fichier SQLite est stocké dans ./data/fliss.sqlite (et ignoré par .gitignore).
