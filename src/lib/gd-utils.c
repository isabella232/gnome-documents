/*
 * Copyright (c) 2011, 2012 Red Hat, Inc.
 *
 * Gnome Documents is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * Gnome Documents is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with Gnome Documents; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Author: Cosimo Cecchi <cosimoc@redhat.com>
 *
 */

#include "config.h"
#include "gd-utils.h"

#include <gdk-pixbuf/gdk-pixbuf.h>
#include <glib/gi18n.h>
#include <string.h>
#include <math.h>

#define GNOME_DESKTOP_USE_UNSTABLE_API
#include <libgnome-desktop/gnome-desktop-thumbnail.h>

#define ATTRIBUTES_FOR_THUMBNAIL \
  G_FILE_ATTRIBUTE_STANDARD_CONTENT_TYPE"," \
  G_FILE_ATTRIBUTE_TIME_MODIFIED

static gboolean
create_thumbnail (GIOSchedulerJob *job,
                  GCancellable *cancellable,
                  gpointer user_data)
{
  GSimpleAsyncResult *result = user_data;
  GFile *file = G_FILE (g_async_result_get_source_object (G_ASYNC_RESULT (result)));
  GnomeDesktopThumbnailFactory *factory = NULL;
  GFileInfo *info = NULL;
  gchar *uri = NULL;
  GdkPixbuf *pixbuf = NULL;
  guint64 mtime;

  uri = g_file_get_uri (file);
  info = g_file_query_info (file, ATTRIBUTES_FOR_THUMBNAIL,
                            G_FILE_QUERY_INFO_NONE,
                            NULL, NULL);

  /* we don't care about reporting errors here, just fail the
   * thumbnail.
   */
  if (info == NULL)
    {
      g_simple_async_result_set_op_res_gboolean (result, FALSE);
      goto out;
    }

  mtime = g_file_info_get_attribute_uint64 (info, G_FILE_ATTRIBUTE_TIME_MODIFIED);

  factory = gnome_desktop_thumbnail_factory_new (GNOME_DESKTOP_THUMBNAIL_SIZE_LARGE);
  pixbuf = gnome_desktop_thumbnail_factory_generate_thumbnail
    (factory, 
     uri, g_file_info_get_content_type (info));

  if (pixbuf != NULL)
    {
      gnome_desktop_thumbnail_factory_save_thumbnail (factory, pixbuf,
                                                      uri, (time_t) mtime);
      g_simple_async_result_set_op_res_gboolean (result, TRUE);
    }
  else
    {
      g_simple_async_result_set_op_res_gboolean (result, FALSE);
    }

 out:
  g_simple_async_result_complete_in_idle (result);
  g_object_unref (result);

  g_clear_object (&info);
  g_object_unref (file);
  g_clear_object (&factory);
  g_clear_object (&pixbuf);
  g_free (uri);
  return FALSE;
}

void
gd_queue_thumbnail_job_for_file_async (GFile *file,
                                       GAsyncReadyCallback callback,
                                       gpointer user_data)
{
  GSimpleAsyncResult *result;

  result = g_simple_async_result_new (G_OBJECT (file),
                                      callback, user_data, 
                                      gd_queue_thumbnail_job_for_file_async);

  g_io_scheduler_push_job (create_thumbnail,
                           result, NULL,
                           G_PRIORITY_DEFAULT, NULL);
}

gboolean
gd_queue_thumbnail_job_for_file_finish (GAsyncResult *res)
{
  GSimpleAsyncResult *simple = G_SIMPLE_ASYNC_RESULT (res);

  return g_simple_async_result_get_op_res_gboolean (simple);
}

const char *
gd_filename_get_extension_offset (const char *filename)
{
	char *end, *end2;

	end = strrchr (filename, '.');

	if (end && end != filename) {
		if (strcmp (end, ".gz") == 0 ||
		    strcmp (end, ".bz2") == 0 ||
		    strcmp (end, ".sit") == 0 ||
		    strcmp (end, ".zip") == 0 ||
		    strcmp (end, ".Z") == 0) {
			end2 = end - 1;
			while (end2 > filename &&
			       *end2 != '.') {
				end2--;
			}
			if (end2 != filename) {
				end = end2;
			}
		}
	}

	return end;
}

/**
 * gd_filename_strip_extension:
 * @filename_with_extension: (allow-none):
 *
 * Returns: (transfer full):
 */
char *
gd_filename_strip_extension (const char * filename_with_extension)
{
	char *filename, *end;

	if (filename_with_extension == NULL) {
		return NULL;
	}

	filename = g_strdup (filename_with_extension);
	end = (gchar *) gd_filename_get_extension_offset (filename);

	if (end && end != filename) {
		*end = '\0';
	}

	return filename;
}

/**
 * gd_iso8601_from_timestamp:
 * @timestamp:
 *
 * Returns: (transfer full):
 */
gchar *
gd_iso8601_from_timestamp (gint64 timestamp)
{
  GTimeVal tv;

  tv.tv_sec = timestamp;
  tv.tv_usec = 0;
  return g_time_val_to_iso8601 (&tv);
}

/**
 * gd_create_collection_icon:
 * @base_size:
 * @pixbufs: (element-type GdkPixbuf):
 *
 * Returns: (transfer full):
 */
GIcon *
gd_create_collection_icon (gint base_size,
                           GList *pixbufs)
{
  cairo_surface_t *surface;
  GIcon *retval;
  cairo_t *cr;
  GtkStyleContext *context;
  GtkWidgetPath *path;
  GtkBorder tile_border;
  gint padding, tile_size;
  gint idx, cur_x, cur_y;
  GList *l;

  context = gtk_style_context_new ();
  gtk_style_context_add_class (context, "documents-collection-icon");

  path = gtk_widget_path_new ();
  gtk_widget_path_append_type (path, GTK_TYPE_ICON_VIEW);
  gtk_style_context_set_path (context, path);
  gtk_widget_path_unref (path);

  surface = cairo_image_surface_create (CAIRO_FORMAT_ARGB32, base_size, base_size);
  cr = cairo_create (surface);

  /* Render the thumbnail itself */
  gtk_render_background (context, cr,
                         0, 0, base_size, base_size);
  gtk_render_frame (context, cr,
                    0, 0, base_size, base_size);

  /* Now, render the tiles inside */
  gtk_style_context_remove_class (context, "documents-collection-icon");
  gtk_style_context_add_class (context, "documents-collection-icon-tile");

  /* TODO: do not hardcode 4, but scale to another layout if more
   * pixbufs are provided.
   */
  padding = MAX (floor (base_size / 10), 4);
  gtk_style_context_get_border (context, GTK_STATE_FLAG_NORMAL, &tile_border);
  tile_size = (base_size - (3 * padding)) / 2 -
    MAX (tile_border.left + tile_border.right, tile_border.top + tile_border.bottom);

  l = pixbufs;
  idx = 0;
  cur_x = padding;
  cur_y = padding;

  while (l != NULL && idx < 4)
    {
      GdkPixbuf *pix;
      gboolean is_thumbnail;
      gint pix_width, pix_height, scale_size;

      pix = l->data;
      is_thumbnail = (gdk_pixbuf_get_option (pix, "-documents-has-thumb") != NULL);

      /* Only draw a box for thumbnails */
      if (is_thumbnail)
        {
          gtk_render_background (context, cr,
                                 cur_x, cur_y,
                                 tile_size + tile_border.left + tile_border.right,
                                 tile_size + tile_border.top + tile_border.bottom);
          gtk_render_frame (context, cr,
                            cur_x, cur_y,
                            tile_size + tile_border.left + tile_border.right,
                            tile_size + tile_border.top + tile_border.bottom);
        }

      pix_width = gdk_pixbuf_get_width (pix);
      pix_height = gdk_pixbuf_get_height (pix);
      scale_size = MIN (pix_width, pix_height);

      cairo_save (cr);

      cairo_translate (cr, cur_x + tile_border.left, cur_y + tile_border.top);
      cairo_rectangle (cr, 0, 0, tile_size, tile_size);
      cairo_clip (cr);

      cairo_scale (cr, (gdouble) tile_size / (gdouble) scale_size, (gdouble) tile_size / (gdouble) scale_size);
      gdk_cairo_set_source_pixbuf (cr, pix, 0, 0);
      cairo_paint (cr);

      cairo_restore (cr);

      if ((idx % 2) == 0)
        {
          cur_x += tile_size + padding + tile_border.left + tile_border.right;
        }
      else
        {
          cur_x = padding;
          cur_y += tile_size + padding + tile_border.top + tile_border.bottom;
        }

      idx++;
      l = l->next;
    }

  retval = G_ICON (gdk_pixbuf_get_from_surface (surface, 0, 0, base_size, base_size));

  cairo_surface_destroy (surface);
  cairo_destroy (cr);
  g_object_unref (context);

  return retval;
}

void
gd_ev_view_find_changed (EvView *view,
                         EvJobFind *job,
                         gint page)
{
  ev_view_find_changed (view,
                        ev_job_find_get_results (job),
                        page);
}

void
gd_show_about_dialog (GtkWindow *parent,
                      gboolean is_books)
{
  const char *artists[] = {
    "Jakub Steiner <jimmac@gmail.com>",
    NULL
  };

  const char *authors[] = {
    "Cosimo Cecchi <cosimoc@gnome.org>",
    "Florian Müllner <fmuellner@gnome.org>",
    "William Jon McCann <william.jon.mccann@gmail.com>",
    "Bastien Nocera <hadess@hadess.net>",
    NULL
  };

  const char *program_name, *comments, *logo_icon_name, *website;

  if(!is_books)
    {
      program_name = _("Documents");
      comments = _("A document manager application");
      logo_icon_name = "org.gnome.Documents";
      website = "https://wiki.gnome.org/Apps/Documents";
    }
  else
    {
      program_name = _("Books");
      comments = _("An e-books manager application");
      logo_icon_name = "org.gnome.Books";
      website = "https://wiki.gnome.org/Apps/Books";
    }

  gtk_show_about_dialog (parent,
                         "artists", artists,
                         "authors", authors,
                         "translator-credits", _("translator-credits"),
                         "program-name", program_name,
                         "comments", comments,
                         "logo-icon-name", logo_icon_name,
                         "website", website,
                         "copyright", "Copyright © 2011-2014 Red Hat, Inc.",
                         "license-type", GTK_LICENSE_GPL_2_0,
                         "version", PACKAGE_VERSION,
                         "wrap-license", TRUE,
                         NULL);
}
