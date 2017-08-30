#!/usr/bin/env python3

import glob
import os
import re
import subprocess
import sys

if not os.environ.get('DESTDIR'):
  # FIXME: meson will not track the creation of these files
  #        https://github.com/mesonbuild/meson/blob/master/mesonbuild/scripts/uninstall.py#L39
  apps = [
    ['org.gnome.Books', 'gnome-books'],
    ['org.gnome.Documents', 'gnome-documents']
  ]

  bindir = sys.argv[2]
  if not os.path.exists(bindir):
    os.makedirs(bindir)

  for app in apps:
    src = os.path.join(sys.argv[1], 'gnome-documents', app[0])
    dest = os.path.join(bindir, app[1])
    subprocess.call(['ln', '-s', '-f', src, dest])

  icondir = os.path.join(sys.argv[1], 'icons', 'hicolor')

  name_pattern = re.compile('hicolor_(?:apps)_(?:\d+x\d+|scalable)_(.*)')
  search_pattern = '/**/hicolor_*'

  [os.rename(file, os.path.join(os.path.dirname(file), name_pattern.search(file).group(1)))
   for file in glob.glob(icondir + search_pattern, recursive=True)]

  print('Update icon cache...')
  subprocess.call(['gtk-update-icon-cache', '-f', '-t', icondir])

  schemadir = os.path.join(sys.argv[1], 'glib-2.0', 'schemas')
  print('Compiling gsettings schemas...')
  subprocess.call(['glib-compile-schemas', schemadir])

  search_pattern = '/*.desktop'

  desktopdir = os.path.join(sys.argv[1], 'applications')
  print('Validate desktop files...')
  [subprocess.call(['desktop-file-validate', file])
   for file in glob.glob(desktopdir + search_pattern, recursive=False)]
