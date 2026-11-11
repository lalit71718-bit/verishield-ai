# Vendored libraries

| File | Library | Version | Licence | Source |
|---|---|---|---|---|
| `motion.js` | [Motion](https://motion.dev) (formerly Framer Motion), vanilla JS build | 14.12.0 | MIT | `dist/motion.js` from the `motion` npm package, https://github.com/motiondivision/motion |

The frontend is plain HTML with no build step, so the library is committed here
and loaded with a `<script>` tag. It exposes a `Motion` global
(`Motion.animate`, `Motion.inView`, `Motion.scroll`, `Motion.stagger`, …).

To upgrade: `npm pack motion@<version>`, then copy `package/dist/motion.js` over
`motion.js` and update the version above.
