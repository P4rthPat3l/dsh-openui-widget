# Notes for this repository

## What this is

A DeepSeek Harness bundle that draws OpenUI widgets in the chat transcript. It registers two host tools, `openui_catalog` and `openui_render`, and claims the client slot `tool.call.toolview` under key `openui_render`.

The widget language is the full `@openuidev/react-ui` chat library, 85 components. `build.ts` reads the installed library and writes `library.generated.ts`, which carries the schema the host validates against and the guide the model reads. Never edit that file by hand and never hand-maintain a component list: it comes from the package.

## The name is load-bearing in three places

The loader resolves bundles by package name, so all three must stay equal to `dsh-openui-widget`:

- `package.json` `name`
- the `cordis.patch.yml` insert row `name`
- the `ID` constant in `build.ts`, which becomes the client loader id

A mismatch shows up as a widget that silently never appears, with no error the user can act on.

## Commands

```bash
npm test           # capture library data, compile both halves, typecheck, run the tests
npm run typecheck  # typecheck only; regenerates library.generated.ts first
npm run bundle     # capture and compile, without tests
```

Sources are TypeScript and only two files ship compiled: `lib/host.js` for the host and `lib/client.js` for the browser. Edit the `.ts` files, never `lib/`. The client bundle inlines the whole library, so it is multi-megabyte by design, and it needs a DOM at module init, which is why the tests install jsdom.

## Display metadata

`locale/en.json` and `locale/zh.json` carry `meta.title` and `meta.description`, read by the Plugin Manager without activating the plugin. `icon.svg` is exported as `./icon`. Both are listed in `files`, so update that list when adding assets.

## Local testing against a profile

The web profile links this directory rather than copying it, so the installed plugin reads whichever files are on disk and `node_modules/` here is the runtime dependency directory for the host half.

To reload the host half after a source change, remove then reinstall the bundle: `plugin_manager` `remove_bundle` with target `dsh-openui-widget`, then `install_bundle` with this directory. Installing alone returns `already-installed`, and a plain restart also works. Reload the page afterwards so it fetches the rebuilt `lib/client.js`, and bump `version` so the install result shows the version you expect.

## Publishing

`npm publish` runs the suite first through `prepublishOnly`. The account requires a one-time password, so publish from a terminal that can prompt. After publishing, replace the local link with the registry copy:

```bash
dsh plugin --profile web add dsh-openui-widget
```
