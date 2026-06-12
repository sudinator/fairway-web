# BirdieNumNum GHIN AutoFill setup

This is the semi-automated GHIN workflow.

## One-time setup

Create a browser bookmark named `BirdieNumNum GHIN AutoFill` and paste this as the bookmark URL:

```text
javascript:(()=>{const s=document.createElement('script');s.src='https://birdienumnum.vercel.app/ghin-autofill.js?'+Date.now();document.body.appendChild(s)})()
```

## Every time you post a round

1. Open a completed round in BirdieNumNum.
2. Select `Round type` and `Starting hole`.
3. Click `Copy Auto-Fill Data + Open GHIN`.
4. In GHIN, select/search the course and tee if GHIN does not auto-fill them.
5. Get to the hole-by-hole entry screen.
6. Turn `Advanced Stats` ON.
7. Click the `BirdieNumNum GHIN AutoFill` bookmark.
8. Paste the JSON if prompted.
9. Review every field carefully, then submit in GHIN yourself.

Important: GHIN can change its webpage at any time. This helper is intentionally review-first: it tries to fill the page, but the golfer should confirm all values before posting.
