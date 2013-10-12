module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    uglify: {
      options: {
        banner: '/*! <%= pkg.name %> <%= grunt.template.today("yyyy-mm-dd") %> */\n'
      },
      build: {
        src: 'client/<%= pkg.name %>.js',
        dest: 'client/<%= pkg.name %>.min.js'
      }
    },
    jshint: {
      all: {
        src: ['client/<%= pkg.name %>.js']
      }
    },
    copy: {
      main: {
        files: [
          {cwd:'client/', src: '*.js', expand: true, dest: 'example/public/javascripts/'}
        ]
      }
    },
    watch: {
      all: {
        files: ['client/playrtc.js'],
        tasks: ['default']
      }
    }
  });

  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-copy');

  // Default task(s).
  grunt.registerTask('default', ['jshint', 'uglify', 'copy']);

};
