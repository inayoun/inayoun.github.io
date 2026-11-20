# Ina Youn's portfolio

Content is authored in `/Users/inayoun/Documents/Obsidian/ina/Publish`.
The local Quartz project's `content` symlink points to that folder. Only notes
and assets inside Publish become part of the website; notes marked `draft: true`
are excluded from the generated site.

From `/Users/inayoun/Documents/portfolio-quartz`:

```sh
bash portfolio.sh preview
```

Open the local URL printed by Quartz. The script selects a working Node 22+
installation, including nvm when available.

To publish an update after editing Obsidian:

```sh
bash portfolio.sh publish
```

This builds the site and publishes to `inayoun/inayoun.github.io` using your
Mac's existing Git login. It saves a source snapshot on `quartz-portfolio` and
the built website on `gh-pages`, preserving both branches' history. The existing
website source remains on `main`.

The publisher uses temporary Git checkouts and copies only the Publish folder
into its content snapshot. Your local content symlink and Quartz Git checkout
stay in place. This direct publishing setup does not require permission to
change GitHub Actions workflows. Workflow files are omitted from source snapshots.

GitHub repository Settings → Pages should use **Deploy from a branch**, with
**gh-pages** and **/(root)**. The public address is `https://inayoun.github.io/`.
Do not push the old site's `main` branch to redeploy it unless you intend to
replace the Quartz site with the previous website.

The active portfolio configuration is `quartz.config.yaml`, which takes
precedence over `quartz.config.default.yaml`.
