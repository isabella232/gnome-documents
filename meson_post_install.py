#!/usr/bin/env python3

import glob
import os
import re
import subprocess
import sys

datadir = sys.argv[1]

destdir = os.environ.get('DESTDIR', '')
bindir = os.path.normpath(destdir + os.sep + sys.argv[2])

# FIXME: meson will not track the creation of these files
#        https://github.com/mesonbuild/meson/blob/master/mesonbuild/scripts/uninstall.py#L39
apps = [
  ['org.gnome.Books', 'gnome-books'],
  ['org.gnome.Documents', 'gnome-documents']
]

if not os.path.exists(bindir):
  os.makedirs(bindir)

for app in apps:
  src = os.path.join(datadir, 'gnome-documents', app[0])
  dest = os.path.join(bindir, app[1])
  subprocess.call(['ln', '-s', '-f', src, dest])

if not os.environ.get('DESTDIR'):
  icondir = os.path.join(datadir, 'icons', 'hicolor')

  print('Update icon cache...')
  subprocess.call(['gtk-update-icon-cache', '-f', '-t', icondir])

  schemadir = os.path.join(datadir, 'glib-2.0', 'schemas')
  print('Compiling gsettings schemas...')
  subprocess.call(['glib-compile-schemas', schemadir])

  search_pattern = '/*.desktop'

  desktopdir = os.path.join(datadir, 'applications')
  print('Validate desktop files...')
  [subprocess.call(['desktop-file-validate', file])
   for file in glob.glob(desktopdir + search_pattern, recursive=False)]
