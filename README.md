# AP2

AP2 is a minimal static site published with GitHub Pages.

## Developer bootstrap

See the [Microsoft Entra developer bootstrap guide](gh-docs/developer-bootstrap.md)
to create or tear down the minimal multi-tenant application registration from
Azure Cloud Shell.

## Run locally

From the repository root, run:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy

GitHub Pages serves `index.html` from the root of the `main` branch. Pushing to
`main` updates the site at <https://seanewest.github.io/ap2/>.
