# VCS diff probe

Register this plugin in a disposable Git project with the built package installed at `../node_modules/feature-pilot`. Create a tracked modification, a new text file, a new binary file and a large new text file. The fixture prints filenames and warnings only; it does not execute shell tools, call a model or alter the test project. The result is a review diff, never a verified worktree identity.
