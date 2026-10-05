# Privacy

whenship stores nothing about you or your plans on its servers. There are no accounts, no database and no cookies.

- **Website.** Your plan is kept in your own browser (local storage) until you clear it. Files you export are created in your browser.
- **Share links.** The whole plan is compressed into the part of the link after `#`. Browsers never send that part to a server, so the link is the only copy. Anyone you give the link to can read the plan.
- **Claude connector.** When Claude calls a whenship tool, the plan is sent to the whenship server, scheduled in memory and returned. It is not logged or kept. Claude's own data handling applies to your conversation.
- **Local use.** `npx whenship` and the offline `whenship.html` file run entirely on your computer.
- **Hosting.** The host of a whenship server may keep standard request logs (time, IP address, path) for security. Plan data is never part of a path.

Questions or concerns: open an issue at <https://github.com/HamedShams/whenship/issues>.
