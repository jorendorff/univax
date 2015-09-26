# Univax: How not to implement collaborative editing

All the code in here is meant as a motivating example
for a talk on [CRDTs](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type).

The hope is that the code will be complicated enough,
or the latency bad enough,
or the fact that we're implementing a whole text editor
self-evidently ridiculous enough,
that CRDTs will seem amazing by comparison.

See http://blog.humphd.org/thimble-and-bramble/ for some reasons
why this is a bad idea:

> One of the things I've loved most about working with the Brackets
> source is that it uses so much of the the best of the open web. Its
> ~1.3 million lines of code offer APIs for things things like:
>
> *   code hinting, static analysis, and linting
> *   language parsing and tokenizing (html, css, js, xml, less)
> *   file system operations
> *   editors
> *   live DOM diff'ing and in-browser preview
> *   swappable servers
> *   layout, widgets, and dialogs
> *   localization, theming, and preferences
> *   extension loading at runtime, with hundreds already written
