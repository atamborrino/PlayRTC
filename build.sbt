name := "playrtc"

organization := "com.github.atamborrino"

version := "0.1-SNAPSHOT"
 
scalaVersion := "2.10.2"
 
resolvers ++= Seq(
  "TypesafeRepo repository" at "http://repo.typesafe.com/typesafe/releases/"
)
 
libraryDependencies ++= Seq(
  "com.typesafe.play"  %% "play" % "2.2.0" % "provided"
)

// Publishing

val localMavenRepo = Path.userHome.absolutePath + "/Projects/maven-atamborrino/"

publishMavenStyle := true

publishTo := {
  if (version.value.trim.endsWith("SNAPSHOT"))
    Some(Resolver.file("snapshots", file(localMavenRepo + "/snapshots")))
  else
    Some(Resolver.file("releases", file(localMavenRepo + "/releases")))
}

// Github publish
lazy val ghPublish = taskKey[Unit]("Publish to your maven github repo")

ghPublish := {
  import scala.sys.process._  
  val mavenRepoFile = new java.io.File(localMavenRepo)
  println("\nPulling your Github maven repo...")
  Process("git pull", mavenRepoFile).!
  // Publish to localMavenRepo
  val _ = publish.value
  // Git add, commit and push
  println("\nWe will now push your local maven repo to Github...")
  Process("git add *", mavenRepoFile).!
  val commitMsg = "Publish " + organization.value + "." + name.value + " " + version.value
  if (Process(Seq("git", "commit",  "-m", commitMsg), mavenRepoFile).! == 0) {
    Process("git push", mavenRepoFile).!
    println(organization.value + "." + name.value + " " + version.value + " has been sucessfully published.")
  } else {
    println("\nNothing new to publish.")
  }
}

