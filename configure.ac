dnl -*- mode: m4 -*-
AC_PREREQ(2.63)
AC_INIT([gnome-documents],[3.24.0],[],[gnome-documents])

AC_CONFIG_HEADERS([config/config.h])
AC_CONFIG_SRCDIR([src/main.js])
AC_CONFIG_MACRO_DIR([m4])
AC_CONFIG_AUX_DIR([config])

m4_ifdef([AM_SILENT_RULES],[AM_SILENT_RULES([yes])])

AC_CANONICAL_TARGET

# require automake 1.11
AM_INIT_AUTOMAKE([1.11 dist-xz no-dist-gzip tar-ustar foreign])
AM_MAINTAINER_MODE([enable])

GETTEXT_PACKAGE=AC_PACKAGE_NAME
AC_SUBST(GETTEXT_PACKAGE)
AC_DEFINE_UNQUOTED(GETTEXT_PACKAGE,"$GETTEXT_PACKAGE",[The name of the gettext domain])
IT_PROG_INTLTOOL(0.50.1)
PKG_PROG_PKG_CONFIG([0.22])

YELP_HELP_INIT

GOBJECT_INTROSPECTION_REQUIRE([0.9.6])

## don't rerun to this point if we abort
AC_CACHE_SAVE

AC_PROG_CC
AM_PROG_CC_C_O
AC_PROG_CXX
AC_ISC_POSIX
AC_HEADER_STDC

# no stupid static libraries
AM_DISABLE_STATIC
# enable libtool
AC_PROG_LIBTOOL
# avoid libtool for LTCOMPILE, use it only to link

## don't rerun to this point if we abort
AC_CACHE_SAVE

GLIB_GSETTINGS
GETTING_STARTED_INIT

AC_CHECK_LIBM
AC_SUBST(LIBM)

EVINCE_MIN_VERSION=3.13.3
WEBKITGTK_MIN_VERSION=2.6.0
GLIB_MIN_VERSION=2.39.3
GJS_MIN_VERSION=1.48.0
GTK_MIN_VERSION=3.22.10
GOBJECT_INTROSPECTION_MIN_VERSION=1.31.6
GDATA_MIN_VERSION=0.13.3
GOA_MIN_VERSION=3.2.0
TRACKER_MIN_VERSION=0.17.3
ZAPOJIT_MIN_VERSION=0.0.2
SOUP_MIN_VERSION=2.41.3

AC_ARG_ENABLE(documentation,
              AS_HELP_STRING([--enable-documentation],
                             [build documentation]),,
              enable_documentation=yes)
if test x$enable_documentation = xyes; then
   AC_PATH_PROG([XSLTPROC], [xsltproc])
   if test x$XSLTPROC = x; then
      AC_MSG_ERROR([xsltproc is required to build documentation])
   fi
fi
AM_CONDITIONAL(BUILD_DOCUMENTATION, test x$enable_documentation = xyes)

PKG_CHECK_MODULES(DOCUMENTS,
                  evince-document-3.0 >= $EVINCE_MIN_VERSION
                  evince-view-3.0 >= $EVINCE_MIN_VERSION
                  webkit2gtk-4.0 >= $WEBKITGTK_MIN_VERSION
                  gjs-1.0 >= $GJS_MIN_VERSION
                  glib-2.0 >= $GLIB_MIN_VERSION
                  gobject-introspection-1.0 >= $GOBJECT_INTROSPECTION_MIN_VERSION
                  gtk+-3.0 >= $GTK_MIN_VERSION
                  libsoup-2.4 >= $SOUP_MIN_VERSION
                  gnome-desktop-3.0
                  tracker-control-1.0 >= $TRACKER_MIN_VERSION
                  tracker-sparql-1.0 >= $TRACKER_MIN_VERSION
                  goa-1.0 >= $GOA_MIN_VERSION
                  libgdata >= $GDATA_MIN_VERSION
                  zapojit-0.0 >= $ZAPOJIT_MIN_VERSION)

# Although GTK+ 3.10 includes hi-dpi functionality, it does not require a cairo with
# cairo_surface_set_device_scale(), which we also need if we're to support hi-dpi,
# so we need check for that explicity.
documents_save_LIBS="$LIBS"
LIBS="$LIBS $DOCUMENTS_LIBS"
AC_CHECK_FUNCS(cairo_surface_set_device_scale)
LIBS="$documents_save_LIBS"

LIBGD_INIT([
  gtk-hacks
  main-view
  notification
  tagged-entry
  gir
])

AX_PROG_GJS
AX_CHECK_GIRS_GJS([cairo], [1.0])
AX_CHECK_GIRS_GJS([EvinceDocument], [3.0])
AX_CHECK_GIRS_GJS([EvinceView], [3.0])
AX_CHECK_GIRS_GJS([GData], [0.0])
AX_CHECK_GIRS_GJS([Gdk], [3.0])
AX_CHECK_GIRS_GJS([GdkPixbuf], [2.0])
AX_CHECK_GIR_SYMBOLS_GJS([Gio], [2.0], [ActionMap.add_action])
AX_CHECK_GIRS_GJS([GLib], [2.0])
AX_CHECK_GIRS_GJS([GnomeDesktop], [3.0])
AX_CHECK_GIRS_GJS([Goa], [1.0])
AX_CHECK_GIRS_GJS([GObject], [2.0])
AX_CHECK_GIR_SYMBOLS_GJS([Gtk], [3.0], [ShortcutsWindow ShortcutsSection
  ShortcutsGroup ShortcutsShortcut])
AX_CHECK_GIRS_GJS([Pango], [1.0])
AX_CHECK_GIRS_GJS([Tracker], [1.0])
AX_CHECK_GIRS_GJS([TrackerControl], [1.0])
AX_CHECK_GIRS_GJS([WebKit2], [4.0])
AX_CHECK_GIRS_GJS([Zpj], [0.0])
AX_CHECK_GIRS_GJS([Gepub], [0.4])

GLIB_COMPILE_RESOURCES=`$PKG_CONFIG --variable glib_compile_resources gio-2.0`
AC_SUBST(GLIB_COMPILE_RESOURCES)

AC_PATH_PROG(DESKTOP_FILE_VALIDATE, desktop-file-validate)

AC_CONFIG_FILES([
Makefile
help/Makefile
libgd/Makefile
src/Makefile
data/Makefile
data/icons/Makefile
getting-started/Makefile
man/Makefile
po/Makefile.in
])

AC_OUTPUT

dnl ==========================================================================
echo "

        gnome-documents $VERSION
        ==================

        prefix:    ${prefix}
        compiler:  ${CC}

        Now type 'make' to build $PACKAGE
"
