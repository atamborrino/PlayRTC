name := "playrtc-example"

version := "0.1.0"

libraryDependencies ++= Seq(
  "com.github.atamborrino" %% "playrtc" % "0.1.+"
)     

resolvers ++= Seq(
  // Resolver.file("Local repo", file("/Users/atamborrino/.ivy2/local"))(Resolver.ivyStylePatterns)
  "Atamborrino repository snapshots" at "https://github.com/atamborrino/maven-atamborrino/raw/master/snapshots/",
  "Atamborrino repository releases" at "https://github.com/atamborrino/maven-atamborrino/raw/master/releases/"
)

play.Project.playScalaSettings
