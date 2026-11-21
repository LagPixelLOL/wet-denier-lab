# Wet Denier Lab

An interactive WebGL toy: tap the stockings to splash water. Splashes burst, wet fabric turns see-through,
beads cling, slide and drip onto the floor. You can switch scenes (studio, bath, street, pool), poses and
outfits (length, cuff, material, denier, color, pattern, hidden decals, or bare legs), take photos and share a link that
restores the exact look. The feet have real toes: bare, or seen through a stocking that stretches over them.

The UI is available in Simplified Chinese (zh-CN) and US English (en-US). It follows the browser's language, and
the globe button in the top corner switches it.

## Run it

Requires Node.js 26 or newer.

```sh
npm install
npm run dev        # dev server on http://localhost:12345 (also reachable from the LAN)
npm run build      # production build into dist/, which can be served from any path
```

## Controls

- Tap or click the stockings to splash; press and drag to pour.
- The dock switches between splash mode and view mode (drag to orbit, pinch or wheel to zoom, tap to zoom in).
- Keyboard: `Space` bucket of water, `1`-`7` poses, `R` rain, `S` slow motion, `D` dry off, `P` photo,
  `V` toggle mode, `C` scenes, `W` wardrobe, arrow keys orbit, `+`/`-` zoom, `0`/`Home` reset view,
  `Esc` close panels.
- The camera only moves when you move it; it does not orbit on its own when idle.
- Resetting the view (and opening a shared one) turns the camera the shortest way round, however many times you
  have turned it around the legs.
- A leg turns see-through while the camera is inside it or within 5 cm of its surface, so close-ups never
  clip into it. It shows again once the camera is more than 7 cm away.
- The copy-link button copies a link to the page the app is running on, of the form
  `#look=1~<pose>~<scene>~<backdrop>~<leg0>~<leg1>~<view>`. The view is the camera as
  `yaw,pitch,dist,targetX,targetY,targetZ`. It is optional, so older links without it still load and keep the
  current camera. Each leg is `length.cuff.garter.material.denier.pattern.color.secret.wetColor`, followed by
  `.0` when its toe is not reinforced. Opening a link applies the look and moves the camera. This also works when pasting a link into a tab that is already open, even the same link the tab already shows.

## Development

How the project is built, laid out and tested, and what to keep in mind when changing it, is in
[DEVELOPMENT.md](DEVELOPMENT.md).

## Credits

- Leg and forefoot meshes: [MakeHuman](http://www.makehumancommunity.org) base mesh (CC0)
- Stocking mesh: adapted from "French lingerie stockings" by punkduck
  ([CC BY 3.0](https://creativecommons.org/licenses/by/3.0/))
- [three.js](https://threejs.org) (MIT)
- Logo font: ZCOOL XiaoWei (subset with the two logo characters)

## License

The code is released under the [MIT License](LICENSE). Third-party assets bundled with it (see Credits) keep their
own licenses.
